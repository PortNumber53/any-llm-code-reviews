// Configuration types
export type LLMProvider = 'gemini' | 'nvidia' | 'openai' | 'anthropic';

export interface AppConfig {
  /** GitHub configuration */
  github: GitHubConfig;
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
}
