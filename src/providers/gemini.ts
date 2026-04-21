/**
 * Google Gemini provider — uses Gemini REST API with structured output.
 *
 * Uses responseSchema for guaranteed JSON output (Gemini's native feature).
 *
 * Popular models:
 *   - gemini-2.0-flash
 *   - gemini-2.5-pro-preview-03-25
 *   - gemini-2.5-flash-preview-04-17
 */

import { httpRequest, parseUrl } from '../http.js';
import type { LLMProviderClient, LLMResponse, LLMProviderConfig } from '../types/llm.js';
import { REVIEW_PROMPT, RESPONSE_SCHEMA } from '../types/llm.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiProvider implements LLMProviderClient {
  readonly name = 'gemini';
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  async reviewDiff(diffContent: string, systemPrompt: string): Promise<LLMResponse> {
    const baseUrl = this.config.baseUrl || DEFAULT_BASE_URL;
    const modelPath = this.config.model.replace(/^models\//, '');
    const url = `${baseUrl}/models/${modelPath}:generateContent`;
    const { hostname, path } = parseUrl(url);

    // Convert our generic JSON schema to Gemini's format
    const geminiSchema = this.toGeminiSchema(RESPONSE_SCHEMA);

    const body = JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt || REVIEW_PROMPT }],
      },
      contents: [
        {
          parts: [
            {
              text: `Here is the diff to review:\n\n${diffContent}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: this.config.temperature,
        maxOutputTokens: this.config.maxTokens,
        responseMimeType: 'application/json',
        responseSchema: geminiSchema,
      },
    });

    try {
      const response = await httpRequest({
        hostname,
        path: `${path}?key=${this.config.apiKey}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
      });

      if (response.statusCode !== 200) {
        return {
          rawText: response.body,
          truncated: false,
          finishReason: 'error',
          error: `Gemini API error ${response.statusCode}: ${response.body}`,
        };
      }

      const parsed = JSON.parse(response.body);

      // Handle safety filter blocks
      if (parsed.promptFeedback?.blockReason) {
        return {
          rawText: response.body,
          truncated: false,
          finishReason: 'blocked',
          error: `Gemini blocked: ${parsed.promptFeedback.blockReason}`,
        };
      }

      const candidate = parsed.candidates?.[0];
      if (!candidate?.content?.parts?.[0]?.text) {
        return {
          rawText: response.body,
          truncated: false,
          finishReason: 'error',
          error: 'No content in Gemini response',
        };
      }

      const rawText = candidate.content.parts[0].text;
      const finishReason = candidate.finishReason || 'unknown';
      const truncated = finishReason === 'MAX_TOKENS';

      let parsedOutput;
      try {
        parsedOutput = JSON.parse(rawText);
      } catch {
        return {
          rawText,
          truncated,
          finishReason,
          error: 'Failed to parse JSON from Gemini response',
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
        error: `Gemini request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Convert generic JSON Schema to Gemini's responseSchema format.
   * Gemini uses uppercase type names (OBJECT, STRING, etc.)
   */
  private toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
    const convertType = (type: string): string => {
      const typeMap: Record<string, string> = {
        object: 'OBJECT',
        string: 'STRING',
        number: 'NUMBER',
        integer: 'INTEGER',
        boolean: 'BOOLEAN',
        array: 'ARRAY',
      };
      return typeMap[type] || type.toUpperCase();
    };

    const convert = (node: Record<string, unknown>): Record<string, unknown> => {
      const result: Record<string, unknown> = {
        type: convertType((node.type as string) || 'string'),
      };

      if (node.description) result.description = node.description;
      if (node.enum) result.enum = node.enum;

      if (node.properties) {
        const props: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(node.properties as Record<string, unknown>)) {
          props[key] = convert(val as Record<string, unknown>);
        }
        result.properties = props;
      }

      if (node.required) result.required = node.required;
      if (node.items) result.items = convert(node.items as Record<string, unknown>);

      return result;
    };

    return convert(schema);
  }
}
