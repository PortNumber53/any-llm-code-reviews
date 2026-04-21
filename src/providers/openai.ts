/**
 * OpenAI provider — uses OpenAI chat completions API with JSON mode.
 *
 * Uses response_format: { type: "json_object" } for structured output
 * and includes the JSON schema in the system prompt.
 *
 * Popular models:
 *   - gpt-4o
 *   - gpt-4o-mini
 *   - gpt-4-turbo
 *   - o1 (note: no temperature/system message support)
 */

import { httpRequest, parseUrl } from '../http.js';
import type { LLMProviderClient, LLMResponse, LLMProviderConfig } from '../types/llm.js';
import { REVIEW_PROMPT, RESPONSE_SCHEMA } from '../types/llm.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAIProvider implements LLMProviderClient {
  readonly name = 'openai';
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  async reviewDiff(diffContent: string, systemPrompt: string): Promise<LLMResponse> {
    const baseUrl = this.config.baseUrl || DEFAULT_BASE_URL;
    const { hostname, path } = parseUrl(`${baseUrl}/chat/completions`);

    const systemMessage = (systemPrompt || REVIEW_PROMPT) +
      `\n\n## JSON Schema\nRespond with JSON matching this schema:\n${JSON.stringify(RESPONSE_SCHEMA, null, 2)}`;

    const body = JSON.stringify({
      model: this.config.model,
      messages: [
        { role: 'system', content: systemMessage },
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
          error: `OpenAI API error ${response.statusCode}: ${response.body}`,
        };
      }

      const parsed = JSON.parse(response.body);
      const choice = parsed.choices?.[0];
      if (!choice?.message?.content) {
        return {
          rawText: response.body,
          truncated: false,
          finishReason: 'error',
          error: 'No content in OpenAI response',
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
          error: 'Failed to parse JSON from OpenAI response',
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
        error: `OpenAI request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
