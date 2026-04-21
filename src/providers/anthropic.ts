/**
 * Anthropic Claude provider — uses Messages API with tool use for structured output.
 *
 * Anthropic doesn't have native JSON mode, so we use tool_use to force
 * structured output matching our schema.
 *
 * Popular models:
 *   - claude-sonnet-4-20250514
 *   - claude-opus-4-20250514
 *   - claude-3-5-sonnet-20241022
 *   - claude-3-5-haiku-20241022
 */

import { httpRequest, parseUrl } from '../http.js';
import type { LLMProviderClient, LLMResponse, LLMProviderConfig } from '../types/llm.js';
import { REVIEW_PROMPT, RESPONSE_SCHEMA } from '../types/llm.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';

export class AnthropicProvider implements LLMProviderClient {
  readonly name = 'anthropic';
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  async reviewDiff(diffContent: string, systemPrompt: string): Promise<LLMResponse> {
    const baseUrl = this.config.baseUrl || DEFAULT_BASE_URL;
    const { hostname, path } = parseUrl(`${baseUrl}/messages`);

    // Convert our JSON schema to Anthropic tool input_schema format
    const toolInputSchema = this.toAnthropicSchema(RESPONSE_SCHEMA);

    const body = JSON.stringify({
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      system: systemPrompt || REVIEW_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Here is the diff to review:\n\n${diffContent}`,
        },
      ],
      tools: [
        {
          name: 'submit_code_review',
          description: 'Submit the structured code review findings',
          input_schema: toolInputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_code_review' },
    });

    try {
      const response = await httpRequest({
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body,
      });

      if (response.statusCode !== 200) {
        return {
          rawText: response.body,
          truncated: false,
          finishReason: 'error',
          error: `Anthropic API error ${response.statusCode}: ${response.body}`,
        };
      }

      const parsed = JSON.parse(response.body);

      // Check for tool_use content block
      const content = parsed.content;
      if (!content || !Array.isArray(content)) {
        return {
          rawText: response.body,
          truncated: false,
          finishReason: 'error',
          error: 'No content in Anthropic response',
        };
      }

      const toolUse = content.find((block: { type: string }) => block.type === 'tool_use');
      if (!toolUse?.input) {
        // Fallback: try text content
        const textBlock = content.find((block: { type: string }) => block.type === 'text');
        if (textBlock?.text) {
          try {
            const parsedOutput = JSON.parse(textBlock.text);
            return {
              rawText: textBlock.text,
              parsed: parsedOutput,
              truncated: parsed.stop_reason === 'max_tokens',
              finishReason: parsed.stop_reason || 'unknown',
            };
          } catch {
            return {
              rawText: textBlock.text,
              truncated: false,
              finishReason: 'error',
              error: 'No tool_use block and text is not valid JSON',
            };
          }
        }
        return {
          rawText: response.body,
          truncated: false,
          finishReason: 'error',
          error: 'No tool_use block in Anthropic response',
        };
      }

      const rawText = JSON.stringify(toolUse.input);
      const finishReason = parsed.stop_reason || 'unknown';
      const truncated = finishReason === 'max_tokens';

      return {
        rawText,
        parsed: toolUse.input,
        truncated,
        finishReason,
      };
    } catch (err) {
      return {
        rawText: '',
        truncated: false,
        finishReason: 'error',
        error: `Anthropic request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Convert generic JSON Schema to Anthropic's input_schema format.
   * Anthropic uses lowercase types like standard JSON Schema.
   */
  private toAnthropicSchema(schema: Record<string, unknown>): Record<string, unknown> {
    // Anthropic uses standard JSON Schema, but we need to clean it up
    const clean = (node: Record<string, unknown>): Record<string, unknown> => {
      const result: Record<string, unknown> = {};

      if (node.type) result.type = node.type;
      if (node.description) result.description = node.description;
      if (node.enum) result.enum = node.enum;

      if (node.properties) {
        const props: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(node.properties as Record<string, unknown>)) {
          props[key] = clean(val as Record<string, unknown>);
        }
        result.properties = props;
      }

      if (node.required) result.required = node.required;
      if (node.items) result.items = clean(node.items as Record<string, unknown>);

      return result;
    };

    return clean(schema);
  }
}
