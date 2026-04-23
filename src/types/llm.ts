// LLM Provider abstraction types

import type { StructuredReviewResponse } from './reviewer.js';

/**
 * Generic LLM provider interface.
 * Each provider (Gemini, NVIDIA, OpenAI, Anthropic) implements this.
 */
export interface LLMProviderClient {
  /** Provider name for logging */
  readonly name: string;

  /**
   * Call the LLM to review a diff.
   * Returns a structured review response with findings.
   */
  reviewDiff(diffContent: string, systemPrompt: string): Promise<LLMResponse>;
}

export interface LLMResponse {
  /** Raw response text (should be JSON) */
  rawText: string;
  /** Parsed structured response (if successful) */
  parsed?: StructuredReviewResponse;
  /** Whether the response was truncated */
  truncated: boolean;
  /** Finish reason from the API */
  finishReason: string;
  /** Any error message */
  error?: string;
}

/**
 * Configuration for creating an LLM provider client
 */
export interface LLMProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature: number;
  maxTokens: number;
}

/**
 * JSON Schema definition for structured output.
 * Used by OpenAI-compatible and Gemini providers.
 */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'High-level summary of the code review' },
    findings: {
      type: 'array',
      description: 'Array of code review findings',
      items: {
        type: 'object',
        properties: {
          severity: {
            type: 'string',
            enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
            description: 'Severity level of the finding',
          },
          file: { type: 'string', description: 'File path where the issue is located' },
          line: { type: 'number', description: 'Line number of the issue' },
          description: { type: 'string', description: 'Description of the issue' },
          suggestion: { type: 'string', description: 'Suggested fix (optional)' },
          rationale: { type: 'string', description: 'Why this is an issue (optional)' },
          original: { type: 'string', description: 'Exact original code to be replaced (required for vibe review)' },
          replacement: { type: 'string', description: 'Exact replacement code (required for vibe review)' },
        },
        required: ['severity', 'file', 'line', 'description'],
      },
    },
  },
  required: ['summary', 'findings'],
};

/**
 * The review prompt sent to all providers.
 */
export const REVIEW_PROMPT = `You are a Principal Software Engineer performing a code review.

## Severity Levels
- **CRITICAL**: Security vulnerabilities, data loss, logic failures that could crash production
- **HIGH**: Performance bottlenecks, architectural violations, functional bugs
- **MEDIUM**: Input validation gaps, error handling issues, naming problems
- **LOW**: Documentation improvements, minor readability issues, style suggestions

## Rules
- Only comment on changed lines (+ or - lines in the diff)
- Include precise line numbers and code suggestions where applicable
- Skip lock files (package-lock.json, yarn.lock, pnpm-lock.yaml) and minified files
- If no issues are found, return an empty findings array
- Be concise but thorough
- Focus on actionable feedback

## Output Format
Return ONLY a JSON object matching this exact structure:
{
  "summary": "string - overall summary of the changes and review",
  "findings": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "file": "path/to/file",
      "line": 123,
      "description": "What the issue is",
      "suggestion": "Optional: how to fix it",
      "rationale": "Optional: why this matters"
    }
  ]
}`;

/**
 * Vibe review prompt — generates actual code replacements for auto-apply.
 * Strictly focuses on fixing issues, not adding features.
 */
export const VIBE_REVIEW_PROMPT = `You are a Principal Software Engineer in VIBE REVIEW mode.
Your job is to automatically fix issues in the code diff by producing exact replacements.

## Severity Levels
- **CRITICAL**: Security vulnerabilities, data loss, logic failures that could crash production
- **HIGH**: Performance bottlenecks, architectural violations, functional bugs
- **MEDIUM**: Input validation gaps, error handling issues, naming problems
- **LOW**: Documentation improvements, minor readability issues, style suggestions

## Vibe Review Rules
- ONLY fix actual issues (bugs, security, performance, correctness)
- DO NOT add new features, unrelated refactors, or stylistic changes
- DO NOT change the intent of the original code changes
- Keep replacements minimal and focused
- Only comment on changed lines (+ or - lines in the diff)
- Skip lock files and minified files
- If no issues are found, return an empty findings array

## Output Format
Return ONLY a JSON object. For every finding you MUST include:
- "original": the EXACT original code to be replaced (must match the file verbatim)
- "replacement": the EXACT replacement code

{
  "summary": "string - overall summary",
  "findings": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "file": "path/to/file",
      "line": 123,
      "description": "What the issue is",
      "rationale": "Why this matters",
      "original": "exact original code",
      "replacement": "exact replacement code"
    }
  ]
}`;
