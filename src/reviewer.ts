/**
 * Reviewer — core review logic with diff filtering and structured output parsing.
 */

import type { Finding, StructuredReviewResponse, ReviewResult, Severity } from './types/reviewer.js';
import type { LLMProviderClient } from './types/llm.js';
import type { ReviewConfig } from './types/config.js';

/**
 * Filter diff content based on include/exclude patterns and size limits.
 */
export function filterDiff(
  diffContent: string,
  config: Pick<ReviewConfig, 'includePatterns' | 'excludePatterns' | 'maxDiffSize'>
): string {
  // Split diff by file sections
  const fileSections = diffContent.split(/(?=^diff --git )/m);

  const filtered: string[] = [];

  for (const section of fileSections) {
    if (!section.trim()) continue;

    // Extract filename from diff header
    const match = section.match(/^diff --git a\/(.+?) b\//m);
    if (!match) {
      filtered.push(section);
      continue;
    }

    const filename = match[1];

    // Check exclude patterns first
    if (config.excludePatterns.length > 0) {
      const excluded = config.excludePatterns.some((pattern) =>
        globToRegex(pattern).test(filename)
      );
      if (excluded) continue;
    }

    // Check include patterns (if specified, file must match at least one)
    if (config.includePatterns.length > 0) {
      const included = config.includePatterns.some((pattern) =>
        globToRegex(pattern).test(filename)
      );
      if (!included) continue;
    }

    filtered.push(section);
  }

  let result = filtered.join('\n');

  // Enforce max diff size
  if (result.length > config.maxDiffSize) {
    result = result.substring(0, config.maxDiffSize);
    result += '\n\n... [DIFF TRUNCATED — exceeded max size] ...';
  }

  return result;
}

/**
 * Convert glob pattern to regex.
 * Simple implementation: * -> .*, ? -> .
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/**
 * Check if there are any CRITICAL findings.
 */
export function hasCriticalFindings(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === 'CRITICAL');
}

/**
 * Validate and sanitize findings from LLM response.
 * Ensures all required fields are present and valid.
 */
export function validateFindings(findings: unknown[]): Finding[] {
  const validSeverities: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  const result: Finding[] = [];

  for (const item of findings) {
    if (typeof item !== 'object' || item === null) continue;
    const finding = item as Record<string, unknown>;

    if (
      typeof finding.severity !== 'string' ||
      !validSeverities.includes(finding.severity as Severity)
    ) {
      continue;
    }

    if (typeof finding.file !== 'string' || typeof finding.line !== 'number') {
      continue;
    }

    if (typeof finding.description !== 'string') {
      continue;
    }

    result.push({
      severity: finding.severity as Severity,
      file: finding.file,
      line: Math.max(1, Math.round(finding.line)),
      description: finding.description,
      suggestion: typeof finding.suggestion === 'string' ? finding.suggestion : undefined,
      rationale: typeof finding.rationale === 'string' ? finding.rationale : undefined,
      original: typeof finding.original === 'string' ? finding.original : undefined,
      replacement: typeof finding.replacement === 'string' ? finding.replacement : undefined,
    });
  }

  return result;
}

/**
 * Perform a code review on the given diff.
 */
export async function reviewDiff(
  provider: LLMProviderClient,
  diffContent: string,
  config: ReviewConfig
): Promise<ReviewResult> {
  // Filter the diff
  const filteredDiff = filterDiff(diffContent, config);

  if (!filteredDiff.trim()) {
    return {
      summary: 'No files to review after filtering.',
      findings: [],
      hasCritical: false,
      provider: provider.name,
      model: 'n/a',
    };
  }

  // Call the LLM
  const response = await provider.reviewDiff(filteredDiff, '');

  if (response.error) {
    throw new Error(`LLM review failed: ${response.error}`);
  }

  if (!response.parsed) {
    throw new Error('LLM returned no parseable output');
  }

  // Validate the response structure
  const rawResponse = response.parsed as unknown as StructuredReviewResponse;
  const summary =
    typeof rawResponse.summary === 'string' ? rawResponse.summary : 'No summary provided';
  const findings = Array.isArray(rawResponse.findings)
    ? validateFindings(rawResponse.findings)
    : [];

  return {
    summary,
    findings,
    hasCritical: hasCriticalFindings(findings),
    provider: provider.name,
    model: 'configured',
  };
}
