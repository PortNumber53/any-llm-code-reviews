/**
 * Configuration — parses environment variables and CLI args into typed config.
 *
 * All config via env vars with sensible defaults.
 * CLI args (--mode, --provider, etc.) override env vars.
 */

import type { AppConfig, LLMProvider, Platform } from './types/config.js';
import { readFileSync } from 'node:fs';

const VALID_PROVIDERS: LLMProvider[] = ['gemini', 'nvidia', 'openai', 'anthropic', 'openrouter'];
const VALID_PLATFORMS: Platform[] = ['github', 'gitlab'];

/**
 * Default model names per provider.
 */
const DEFAULT_MODELS: Record<LLMProvider, string> = {
  gemini: 'gemini-2.0-flash',
  nvidia: 'meta/llama-3.3-70b-instruct',
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  openrouter: 'openrouter/free',
};

/**
 * Detect provider from model name.
 * Allows --model to auto-select the correct provider.
 *
 * Patterns:
 *   nvidia:    meta/*, mistralai/*, deepseek-ai/*, nvidia/*
 *   gemini:    gemini-*
 *   openai:    gpt-*, o1, o3-*, chatgpt-*, text-*, davinci-*
 *   anthropic: claude-*
 */
function detectProviderFromModel(model: string): LLMProvider | null {
  if (/^(meta|mistralai|deepseek-ai|nvidia)\//i.test(model)) return 'nvidia';
  if (/^gemini/i.test(model)) return 'gemini';
  if (/^(gpt|o[13]|chatgpt|text|davinci)/i.test(model)) return 'openai';
  if (/^claude/i.test(model)) return 'anthropic';
  if (/^openrouter\//i.test(model)) return 'openrouter';
  // Unknown model name — fall through to --provider / LLM_PROVIDER / default
  return null;
}

/**
 * Default API base URLs per provider.
 */
const DEFAULT_BASE_URLS: Record<LLMProvider, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

/**
 * Parse and validate config from environment variables and CLI args.
 */
export function loadConfig(cliArgs: Record<string, string | boolean>): AppConfig {
  // If --model is provided, try to auto-detect provider from model name
  const modelArg = cliArgs.model as string | undefined;
  const detectedProvider = modelArg ? detectProviderFromModel(modelArg) : null;

  if (modelArg && detectedProvider === null) {
    console.warn(`[config] Could not auto-detect provider from model "${modelArg}". ` +
      `Falling back to --provider / LLM_PROVIDER. ` +
      `Use --provider to specify explicitly.`);
  }

  const provider = (detectedProvider || cliArgs.provider as string || env('LLM_PROVIDER') || 'nvidia') as LLMProvider;
  if (!VALID_PROVIDERS.includes(provider)) {
    throw new Error(
      `Invalid LLM provider: ${provider}. Valid: ${VALID_PROVIDERS.join(', ')}`
    );
  }

  // Resolve platform
  const platform = (cliArgs.platform as string || env('PLATFORM') || 'github') as Platform;
  if (!VALID_PLATFORMS.includes(platform)) {
    throw new Error(
      `Invalid platform: ${platform}. Valid: ${VALID_PLATFORMS.join(', ')}`
    );
  }

  // Resolve API key based on provider
  const apiKey = resolveApiKey(provider);

  // Parse platform-specific config
  let github: AppConfig['github'];
  let gitlab: AppConfig['gitlab'];

  if (platform === 'github') {
    github = {
      token: requiredEnv('GITHUB_TOKEN'),
      baseUrl: env('GITHUB_API_URL') || 'https://api.github.com',
      owner: requiredEnv('GITHUB_REPO_OWNER'),
      repo: requiredEnv('GITHUB_REPO_NAME'),
      pullNumber: parseInt((cliArgs.pr as string) || requiredEnv('GITHUB_PR_NUMBER'), 10),
    };
  } else {
    const token = env('GITLAB_TOKEN') || env('CI_JOB_TOKEN') || '';
    gitlab = {
      token,
      baseUrl: env('GITLAB_API_URL') || env('CI_API_V4_URL') || 'https://gitlab.com/api/v4',
      namespace: env('GITLAB_NAMESPACE') || env('CI_PROJECT_NAMESPACE') || '',
      project: env('GITLAB_PROJECT') || env('CI_PROJECT_NAME') || '',
      mergeRequestIid: parseInt((cliArgs.mr as string) || env('GITLAB_MR_IID') || env('CI_MERGE_REQUEST_IID') || '0', 10),
    };

    const tokenSource = env('GITLAB_TOKEN') ? 'GITLAB_TOKEN' : (env('CI_JOB_TOKEN') ? 'CI_JOB_TOKEN' : 'none');
    console.log(`[config] GitLab token source: ${tokenSource}`);

    if (!gitlab.token) {
      throw new Error('Missing GitLab token. Set GITLAB_TOKEN or run in GitLab CI (CI_JOB_TOKEN is auto-provided).');
    }
    if (!gitlab.namespace || !gitlab.project) {
      throw new Error('Missing GitLab project info. Set GITLAB_NAMESPACE and GITLAB_PROJECT (or run in GitLab CI where CI_PROJECT_NAMESPACE and CI_PROJECT_NAME are auto-provided).');
    }
    if (!gitlab.mergeRequestIid) {
      throw new Error('Missing GitLab MR IID. Set GITLAB_MR_IID (or CI_MERGE_REQUEST_IID) or use --mr <iid>.');
    }
  }

  // Parse LLM config
  const llm = {
    provider,
    apiKey,
    model: modelArg || env(`${provider.toUpperCase()}_MODEL`) || DEFAULT_MODELS[provider],
    baseUrl: env(`${provider.toUpperCase()}_BASE_URL`) || DEFAULT_BASE_URLS[provider],
    temperature: parseFloat(env('LLM_TEMPERATURE') || '0.2'),
    maxTokens: parseInt(env('LLM_MAX_TOKENS') || '8192', 10),
  };

  // Parse review config
  const review = {
    maxFiles: parseInt(env('REVIEW_MAX_FILES') || '50', 10),
    maxDiffSize: parseInt(env('REVIEW_MAX_DIFF_SIZE') || '100000', 10),
    includePatterns: parsePatterns(env('REVIEW_INCLUDE_PATTERNS') || ''),
    excludePatterns: parsePatterns(
      env('REVIEW_EXCLUDE_PATTERNS') ||
        'package-lock.json,yarn.lock,pnpm-lock.yaml,*.min.js,*.min.css,.min.*,vendor/*,dist/*,build/*'
    ),
    postAsComment: env('REVIEW_POST_AS_COMMENT') !== 'false',
    failOnCritical: env('REVIEW_FAIL_ON_CRITICAL') === 'true',
    vibeReview: isTruthy(env('VIBE_REVIEW')) || cliArgs['vibe-review'] === true,
    vibeReviewPrompt: loadVibeReviewPrompt(cliArgs),
  };

  return { platform, github, gitlab, llm, review };
}

/**
 * Resolve API key for the given provider.
 * Checks provider-specific env var first, then generic fallbacks.
 */
function resolveApiKey(provider: LLMProvider): string {
  const providerKeyMap: Record<LLMProvider, string[]> = {
    gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    nvidia: ['NVIDIA_API_KEY', 'NIM_API_KEY'],
    openai: ['OPENAI_API_KEY'],
    anthropic: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
    openrouter: ['OPENROUTER_API_KEY'],
  };

  for (const key of providerKeyMap[provider]) {
    const value = env(key);
    if (value) return value;
  }

  throw new Error(
    `Missing API key for provider ${provider}. ` +
    `Set one of: ${providerKeyMap[provider].join(', ')}`
  );
}

/**
 * Check if an env var value is truthy (true, 1, yes, on).
 */
function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase().trim());
}
function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

/**
 * Get required environment variable (throws if missing).
 */
function requiredEnv(name: string): string {
  const value = env(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Load custom vibe review prompt from env var or CLI arg.
 * CLI arg `--vibe-review-prompt` can be a file path (read) or raw string.
 * Env var `VIBE_REVIEW_PROMPT` is treated as raw string.
 */
function loadVibeReviewPrompt(cliArgs: Record<string, string | boolean>): string | undefined {
  const envPrompt = env('VIBE_REVIEW_PROMPT');
  const argPrompt = cliArgs['vibe-review-prompt'] as string | undefined;

  const raw = argPrompt || envPrompt;
  if (!raw) return undefined;

  // If it looks like a file path, try reading it
  if (raw.includes('/') || raw.includes('\\') || raw.endsWith('.txt') || raw.endsWith('.md')) {
    try {
      return readFileSync(raw, 'utf-8');
    } catch {
      // Not a readable file — fall through to treat as raw prompt string
    }
  }

  return raw;
}

/**
 * Parse comma-separated glob patterns.
 */
function parsePatterns(input: string): string[] {
  return input
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}
