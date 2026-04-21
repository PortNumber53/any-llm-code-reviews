/**
 * LLM Provider factory — creates the right provider based on config.
 */

import type { LLMProviderClient, LLMProviderConfig } from '../types/llm.js';
import type { LLMProvider } from '../types/config.js';
import { NVIDIAProvider } from './nvidia.js';
import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';

export function createProvider(
  provider: LLMProvider,
  config: LLMProviderConfig
): LLMProviderClient {
  switch (provider) {
    case 'nvidia':
      return new NVIDIAProvider(config);
    case 'gemini':
      return new GeminiProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

export { NVIDIAProvider, GeminiProvider, OpenAIProvider, AnthropicProvider };
