// Configuration types
export type LLMProvider = 'gemini' | 'nvidia' | 'openai' | 'anthropic' | 'openrouter';
export type Platform = 'github' | 'gitlab';

export interface AppConfig {
  /** Platform (github or gitlab) */
  platform: Platform;
  /** GitHub configuration (when platform is github) */
  github?: GitHubConfig;
  /** GitLab configuration (when platform is gitlab) */
  gitlab?: GitLabConfig;
  /** LLM provider configuration */
  llm: LLMConfig;
  /** Review settings */
  review: ReviewConfig;
}

export interface GitHubConfig {
  /** GitHub token (PAT or GitHub App token) */
  token: string;
  /** GitHub API base URL (for GitHub Enterprise) */
  baseUrl: string;
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Pull request number */
  pullNumber: number;
}

export interface GitLabConfig {
  /** GitLab token (PAT or CI job token) */
  token: string;
  /** GitLab API base URL (v4) */
  baseUrl: string;
  /** Project namespace (group or username) */
  namespace: string;
  /** Project name */
  project: string;
  /** Merge request IID */
  mergeRequestIid: number;
}

export interface LLMConfig {
  /** Which LLM provider to use */
  provider: LLMProvider;
  /** API key for the provider */
  apiKey: string;
  /** Model name */
  model: string;
  /** API base URL (for NVIDIA, OpenAI-compatible endpoints) */
  baseUrl?: string;
  /** Temperature for generation */
  temperature: number;
  /** Max output tokens */
  maxTokens: number;
}

export interface ReviewConfig {
  /** Max files to review */
  maxFiles: number;
  /** Max diff size in characters */
  maxDiffSize: number;
  /** Comma-separated glob patterns to include */
  includePatterns: string[];
  /** Comma-separated glob patterns to exclude */
  excludePatterns: string[];
  /** Post review as PR comment */
  postAsComment: boolean;
  /** Fail on critical findings */
  failOnCritical: boolean;
  /** Auto-apply vibe review fixes */
  vibeReview: boolean;
  /** Custom vibe review prompt (optional, overrides default) */
  vibeReviewPrompt?: string;
}
