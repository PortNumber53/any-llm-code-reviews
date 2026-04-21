/**
 * NVIDIA NIM provider — uses OpenAI-compatible API at integrate.api.nvidia.com
 *
 * NVIDIA's API is OpenAI-compatible, so we use the chat completions endpoint
 * with JSON mode for structured output.
 *
 * Popular models:
 *   - meta/llama-3.1-405b-instruct
 *   - meta/llama-3.1-70b-instruct
 *   - meta/llama-3.3-70b-instruct
 *   - mistralai/mixtral-8x22b-instruct-v0.1
 *   - nvidia/nemotron-4-340b-instruct
 */

import { httpRequest, parseUrl } from '../http.js';
import type { LLMProviderClient, LLMResponse, LLMProviderConfig } from '../types/llm.js';
import { REVIEW_PROMPT, RESPONSE_SCHEMA } from '../types/llm.js';

const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export class NVIDIAProvider implements LLMProviderClient {
  readonly name = 'nvidia';
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  async reviewDiff(diffContent: string, systemPrompt: string): Promise<LLMResponse> {
    const baseUrl = this.config.baseUrl || DEFAULT_BASE_URL;
    const { hostname, path } = parseUrl(`${baseUrl}/chat/completions`);

    const body = JSON.stringify({
      model: this.config.model,
      messages: [
        { role: 'system', content: systemPrompt || REVIEW_PROMPT },
        {
          role: 'user',
          content: `Here is the diff to review:\n\n${diffContent}`,
        },
      ],
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      response_format: { type: 'json_object' },
    });

    try {
      const response = await httpRequest({
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body,
      });

      if (response.statusCode !== 200) {
        return {
          rawText: response.body,
          truncated: false,
          finishReason: 'error',
          error: `NVIDIA API error ${response.statusCode}: ${response.body}`,
        };
      }

      const parsed = JSON.parse(response.body);
      const choice = parsed.choices?.[0];
      if (!choice?.message?.content) {
        return {
          rawText: response.body,
          truncated: false,
          finishReason: 'error',
          error: 'No content in NVIDIA response',
        };
      }

      const rawText = choice.message.content;
      const finishReason = choice.finish_reason || 'unknown';
      const truncated = finishReason === 'length';

      let parsedOutput;
      try {
        parsedOutput = JSON.parse(rawText);
      } catch {
        return {
          rawText,
          truncated,
          finishReason,
          error: 'Failed to parse JSON from NVIDIA response',
        };
      }

      return {
        rawText,
        parsed: parsedOutput,
        truncated,
        finishReason,
      };
    } catch (err) {
      return {
        rawText: '',
        truncated: false,
        finishReason: 'error',
        error: `NVIDIA request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
