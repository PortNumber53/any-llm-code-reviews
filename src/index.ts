/**
 * Main orchestration — ties together GitHub API, LLM provider, and reviewer.
 *
 * Two modes:
 *   - runPullRequestReview(): Full GitHub PR review (fetch diff, review, post comments)
 *   - runDiffReview(): Review a local git diff (no GitHub interaction)
 */

import { execSync } from 'node:child_process';
import { GitHubApiClient } from './github-api.js';
import { createProvider } from './providers/index.js';
import { filterDiff, validateFindings, hasCriticalFindings } from './reviewer.js';
import type { AppConfig } from './types/config.js';
import type { ReviewResult, Finding, SEVERITY_EMOJI } from './types/reviewer.js';
import type { LLMProviderClient, LLMProviderConfig } from './types/llm.js';

const COMMENT_MARKER = '<!-- niteni-review -->';

/**
 * Run a full pull request review:
 * 1. Fetch PR metadata and changed files from GitHub
 * 2. Assemble diff from patches
 * 3. Filter diff (include/exclude patterns, size limit)
 * 4. Send to LLM for review
 * 5. Clean up old niteni comments
 * 6. Post new review as PR comment
 */
export async function runPullRequestReview(config: AppConfig): Promise<ReviewResult> {
  console.log(`\n[review] Starting PR review for ${config.github.owner}/${config.github.repo}#${config.github.pullNumber}`);
  console.log(`[review] Provider: ${config.llm.provider} | Model: ${config.llm.model}`);

  // 1. Create GitHub API client
  const github = new GitHubApiClient(config.github);

  // 2. Fetch PR data in parallel
  console.log('[review] Fetching PR data...');
  const [pr, files] = await Promise.all([
    github.getPullRequest(),
    github.getPRFiles(),
  ]);

  console.log(`[review] PR: "${pr.title}" (${pr.state})`);
  console.log(`[review] Changed files: ${files.length}`);

  if (files.length === 0) {
    console.log('[review] No files changed. Skipping review.');
    return { summary: 'No files changed.', findings: [], hasCritical: false, provider: config.llm.provider, model: config.llm.model };
  }

  // 3. Assemble and filter diff
  let diffContent = github.assembleDiffFromFiles(files);
  console.log(`[review] Raw diff size: ${diffContent.length} chars`);

  diffContent = filterDiff(diffContent, config.review);
  console.log(`[review] Filtered diff size: ${diffContent.length} chars`);

  if (!diffContent.trim() || diffContent.includes('[DIFF TRUNCATED') && diffContent.length < 200) {
    console.log('[review] No reviewable content after filtering.');
    return { summary: 'No reviewable content after filtering.', findings: [], hasCritical: false, provider: config.llm.provider, model: config.llm.model };
  }

  // 4. Create LLM provider and run review
  const providerConfig: LLMProviderConfig = {
    apiKey: config.llm.apiKey,
    model: config.llm.model,
    baseUrl: config.llm.baseUrl,
    temperature: config.llm.temperature,
    maxTokens: config.llm.maxTokens,
  };
  const provider = createProvider(config.llm.provider, providerConfig);

  console.log(`[review] Calling ${config.llm.provider} for review...`);
  const response = await provider.reviewDiff(diffContent, '');

  if (response.error) {
    throw new Error(`LLM review failed: ${response.error}`);
  }

  if (!response.parsed) {
    throw new Error('LLM returned no parseable output');
  }

  // 5. Parse and validate findings
  const rawResponse = response.parsed as { summary?: string; findings?: unknown[] };
  const summary = typeof rawResponse.summary === 'string' ? rawResponse.summary : 'No summary';
  const findings = Array.isArray(rawResponse.findings) ? validateFindings(rawResponse.findings) : [];
  const hasCritical = hasCriticalFindings(findings);

  console.log(`[review] Summary: ${summary}`);
  console.log(`[review] Findings: ${findings.length} (${hasCritical ? 'HAS CRITICAL' : 'no critical'})`);

  if (response.truncated) {
    console.warn('[review] WARNING: LLM response was truncated. Some findings may be missing.');
  }

  // 6. Post review to GitHub
  if (config.review.postAsComment) {
    // Clean up old comments
    console.log('[review] Cleaning up old review comments...');
    try {
      const deleted = await github.cleanupOldReviews();
      if (deleted > 0) {
        console.log(`[review] Deleted ${deleted} old comment(s)`);
      }
    } catch (err) {
      console.warn('[review] Failed to clean up old comments:', err);
    }

    // Build review body
    const reviewBody = buildReviewComment(summary, findings, config);

    console.log('[review] Posting review comment...');
    await github.postComment(reviewBody);
    console.log('[review] Review posted successfully.');
  }

  return {
    summary,
    findings,
    hasCritical,
    provider: config.llm.provider,
    model: config.llm.model,
  };
}

/**
 * Run a local diff review (no GitHub interaction).
 * Useful for local development or testing.
 */
export async function runDiffReview(
  config: AppConfig,
  targetBranch: string = 'main'
): Promise<ReviewResult> {
  console.log(`\n[review] Running local diff review against ${targetBranch}`);
  console.log(`[review] Provider: ${config.llm.provider} | Model: ${config.llm.model}`);

  // Get local git diff
  console.log('[review] Getting git diff...');
  let diffContent: string;
  try {
    diffContent = execSync(`git diff ${targetBranch}...HEAD`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(
      `Failed to get git diff: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!diffContent.trim()) {
    console.log('[review] No diff found.');
    return { summary: 'No diff found.', findings: [], hasCritical: false, provider: config.llm.provider, model: config.llm.model };
  }

  // Filter diff
  diffContent = filterDiff(diffContent, config.review);
  console.log(`[review] Filtered diff size: ${diffContent.length} chars`);

  // Create LLM provider and run review
  const providerConfig: LLMProviderConfig = {
    apiKey: config.llm.apiKey,
    model: config.llm.model,
    baseUrl: config.llm.baseUrl,
    temperature: config.llm.temperature,
    maxTokens: config.llm.maxTokens,
  };
  const provider = createProvider(config.llm.provider, providerConfig);

  console.log(`[review] Calling ${config.llm.provider} for review...`);
  const response = await provider.reviewDiff(diffContent, '');

  if (response.error) {
    throw new Error(`LLM review failed: ${response.error}`);
  }

  if (!response.parsed) {
    throw new Error('LLM returned no parseable output');
  }

  const rawResponse = response.parsed as { summary?: string; findings?: unknown[] };
  const summary = typeof rawResponse.summary === 'string' ? rawResponse.summary : 'No summary';
  const findings = Array.isArray(rawResponse.findings) ? validateFindings(rawResponse.findings) : [];
  const hasCritical = hasCriticalFindings(findings);

  return {
    summary,
    findings,
    hasCritical,
    provider: config.llm.provider,
    model: config.llm.model,
  };
}

/**
 * Build the review comment body for GitHub.
 */
function buildReviewComment(
  summary: string,
  findings: Finding[],
  config: AppConfig
): string {
  const lines: string[] = [];

  lines.push(COMMENT_MARKER);
  lines.push(`## AI Code Review — ${config.llm.provider}/${config.llm.model}`);
  lines.push('');
  lines.push(summary);
  lines.push('');

  if (findings.length === 0) {
    lines.push('No issues found. The code looks good!');
    lines.push('');
    lines.push('> _Powered by niteni-multi-llm_');
    return lines.join('\n');
  }

  // Group findings by severity
  const severityOrder: Finding['severity'][] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  const emojiMap: Record<string, string> = {
    CRITICAL: '🔴',
    HIGH: '🟠',
    MEDIUM: '🔵',
    LOW: '⚪',
  };

  const grouped = new Map<string, Finding[]>();
  for (const finding of findings) {
    const list = grouped.get(finding.severity) || [];
    list.push(finding);
    grouped.set(finding.severity, list);
  }

  for (const severity of severityOrder) {
    const list = grouped.get(severity);
    if (!list || list.length === 0) continue;

    const emoji = emojiMap[severity];
    lines.push(`### ${emoji} ${severity} (${list.length})`);
    lines.push('');

    for (const finding of list) {
      lines.push(`**\`${finding.file}:${finding.line}\`**`);
      lines.push('');
      lines.push(finding.description);
      lines.push('');

      if (finding.suggestion) {
        lines.push('> **Suggestion:**');
        lines.push('>');
        // Indent suggestion as quote
        const suggestionLines = finding.suggestion.split('\n');
        for (const line of suggestionLines) {
          lines.push(`> ${line}`);
        }
        lines.push('');
      }

      if (finding.rationale) {
        lines.push(`> _${finding.rationale}_`);
        lines.push('');
      }
    }
  }

  lines.push('---');
  lines.push('> _Powered by niteni-multi-llm_');

  return lines.join('\n');
}
