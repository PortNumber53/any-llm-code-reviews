// Reviewer types

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface Finding {
  /** Severity level */
  severity: Severity;
  /** File path */
  file: string;
  /** Line number */
  line: number;
  /** Issue description */
  description: string;
  /** Suggested fix (optional) */
  suggestion?: string;
  /** Why this is an issue (optional) */
  rationale?: string;
}

export interface StructuredReviewResponse {
  /** High-level summary of the review */
  summary: string;
  /** Individual findings */
  findings: Finding[];
}

export interface ReviewResult {
  /** Review summary */
  summary: string;
  /** All findings */
  findings: Finding[];
  /** Whether any CRITICAL findings exist */
  hasCritical: boolean;
  /** LLM provider used */
  provider: string;
  /** Model used */
  model: string;
}

export const SEVERITY_EMOJI: Record<Severity, string> = {
  CRITICAL: '🔴',
  HIGH: '🟠',
  MEDIUM: '🔵',
  LOW: '⚪',
};
