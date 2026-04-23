/**
 * Main orchestration — ties together platform API, LLM provider, and reviewer.
 *
 * Three modes:
 *   - runPullRequestReview(): Full GitHub PR review (fetch diff, review, post comments)
 *   - runMergeRequestReview(): Full GitLab MR review (fetch diff, review, post notes)
 *   - runDiffReview(): Review a local git diff (no platform interaction)
 */

import { execSync } from 'node:child_process';
import { GitHubApiClient } from './github-api.js';
import { GitLabApiClient } from './gitlab-api.js';
import type { DiffRefs } from './types/gitlab.js';
import { createProvider } from './providers/index.js';
import { filterDiff, validateFindings, hasCriticalFindings } from './reviewer.js';
import { applyFixes, commitAndPushIfInCI } from './applier.js';
import type { AppConfig } from './types/config.js';
import type { ReviewResult, Finding, SEVERITY_EMOJI } from './types/reviewer.js';
import type { LLMProviderClient, LLMProviderConfig } from './types/llm.js';
import { REVIEW_PROMPT, VIBE_REVIEW_PROMPT } from './types/llm.js';

const COMMENT_MARKER = '<!-- niteni-review -->';

/**
 * Run a full pull request review:
 * 1. Fetch PR metadata and changed files from GitHub
 * 2. Assemble diff from patches
 * 3. Filter diff (include/exclude patterns, size limit)
 * 4. Send to LLM for review
 * 5. Clean up old review comments
 * 6. Post new review as PR comment
 */
export async function runPullRequestReview(config: AppConfig): Promise<ReviewResult> {
  if (!config.github) {
    throw new Error('GitHub configuration is required for pull request review');
  }

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
  const systemPrompt = config.review.vibeReview
    ? (config.review.vibeReviewPrompt || VIBE_REVIEW_PROMPT)
    : REVIEW_PROMPT;
  const response = await provider.reviewDiff(diffContent, systemPrompt);

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

  // 5b. Vibe review — auto-apply fixes
  if (config.review.vibeReview && findings.length > 0) {
    console.log('[vibe] Auto-applying fixes...');
    const applyResult = applyFixes(findings);
    console.log(`[vibe] Applied ${applyResult.applied} fix(es) across ${applyResult.files.length} file(s)`);
    if (applyResult.skipped > 0) {
      console.log(`[vibe] Skipped ${applyResult.skipped} fix(es)`);
    }
    for (const err of applyResult.errors) {
      console.warn(`[vibe] ${err}`);
    }
    commitAndPushIfInCI();
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
 * Run a full merge request review on GitLab:
 * 1. Fetch MR metadata and changes from GitLab API
 * 2. Assemble diff from changes
 * 3. Filter diff (include/exclude patterns, size limit)
 * 4. Send to LLM for review
 * 5. Clean up old review notes
 * 6. Post new review as MR note
 */
export async function runMergeRequestReview(config: AppConfig): Promise<ReviewResult> {
  if (!config.gitlab) {
    throw new Error('GitLab configuration is required for merge request review');
  }

  console.log(`\n[review] Starting MR review for ${config.gitlab.namespace}/${config.gitlab.project}!${config.gitlab.mergeRequestIid}`);
  console.log(`[review] Provider: ${config.llm.provider} | Model: ${config.llm.model}`);

  // 1. Create GitLab API client
  const gitlab = new GitLabApiClient(config.gitlab);

  // 2. Fetch MR data in parallel
  console.log('[review] Fetching MR data...');
  const [mr, changes] = await Promise.all([
    gitlab.getMergeRequest(),
    gitlab.getMRChanges(),
  ]);

  console.log(`[review] MR: "${mr.title}" (${mr.state})`);
  console.log(`[review] Changed files: ${changes.changes.length}`);

  if (changes.changes.length === 0) {
    console.log('[review] No files changed. Skipping review.');
    return { summary: 'No files changed.', findings: [], hasCritical: false, provider: config.llm.provider, model: config.llm.model };
  }

  // 3. Assemble and filter diff
  let diffContent = gitlab.assembleDiffFromChanges(changes.changes);
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
  const systemPrompt = config.review.vibeReview
    ? (config.review.vibeReviewPrompt || VIBE_REVIEW_PROMPT)
    : REVIEW_PROMPT;
  const response = await provider.reviewDiff(diffContent, systemPrompt);

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

  // 5b. Vibe review — auto-apply fixes
  if (config.review.vibeReview && findings.length > 0) {
    console.log('[vibe] Auto-applying fixes...');
    const applyResult = applyFixes(findings);
    console.log(`[vibe] Applied ${applyResult.applied} fix(es) across ${applyResult.files.length} file(s)`);
    if (applyResult.skipped > 0) {
      console.log(`[vibe] Skipped ${applyResult.skipped} fix(es)`);
    }
    for (const err of applyResult.errors) {
      console.warn(`[vibe] ${err}`);
    }
    commitAndPushIfInCI();
  }

  // 6. Post review to GitLab
  if (config.review.postAsComment) {
    // Clean up old notes and discussions
    console.log('[review] Cleaning up old review notes and discussions...');
    try {
      const deleted = await gitlab.cleanupOldReviews();
      if (deleted > 0) {
        console.log(`[review] Deleted ${deleted} old review item(s)`);
      }
    } catch (err) {
      console.warn('[review] Failed to clean up old reviews:', err);
    }

    // Get diff_refs for positioning inline comments
    const diffRefs = mr.diff_refs || changes.diff_refs;
    if (!diffRefs) {
      console.warn('[review] No diff_refs available. Posting as summary note only.');
      const reviewBody = buildReviewComment(summary, findings, config);
      await gitlab.postNote(reviewBody);
    } else {
      // Build a set of changed file paths for validation
      const changedFiles = new Set(changes.changes.map(f => f.new_path));

      // Post inline comment for each finding
      let inlinePosted = 0;
      let inlineFailed = 0;

      for (const finding of findings) {
        if (changedFiles.has(finding.file) && finding.line > 0) {
          const body = buildFindingComment(finding);
          try {
            await gitlab.createDiscussion(body, {
              base_sha: diffRefs.base_sha,
              head_sha: diffRefs.head_sha,
              start_sha: diffRefs.start_sha,
              position_type: 'text',
              new_path: finding.file,
              new_line: finding.line,
            });
            inlinePosted++;
          } catch (err) {
            console.warn(`[review] Failed to post inline comment on ${finding.file}:${finding.line}: ${err instanceof Error ? err.message : err}`);
            inlineFailed++;
            // Fallback: include in summary note
          }
        }
      }

      // Post summary note
      const summaryBody = buildGitLabSummaryNote(summary, findings, config, inlinePosted, inlineFailed);
      await gitlab.postNote(summaryBody);

      console.log(`[review] Posted ${inlinePosted} inline comment(s), ${inlineFailed} fallback to summary.`);
    }

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
 * Run a local diff review (no platform interaction).
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
  const systemPrompt = config.review.vibeReview
    ? (config.review.vibeReviewPrompt || VIBE_REVIEW_PROMPT)
    : REVIEW_PROMPT;
  const response = await provider.reviewDiff(diffContent, systemPrompt);

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

  // Vibe review — auto-apply fixes locally
  if (config.review.vibeReview && findings.length > 0) {
    console.log('[vibe] Auto-applying fixes...');
    const applyResult = applyFixes(findings);
    console.log(`[vibe] Applied ${applyResult.applied} fix(es) across ${applyResult.files.length} file(s)`);
    if (applyResult.skipped > 0) {
      console.log(`[vibe] Skipped ${applyResult.skipped} fix(es)`);
    }
    for (const err of applyResult.errors) {
      console.warn(`[vibe] ${err}`);
    }
    commitAndPushIfInCI();
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
  if (config.review.vibeReview) {
    lines.push('');
    lines.push('> ✨ **Vibe Review enabled** — fixes were auto-applied to this branch where possible.');
  }
  lines.push('');
  lines.push(summary);
  lines.push('');

  if (findings.length === 0) {
    lines.push('No issues found. The code looks good!');
    lines.push('');
    lines.push('> _Powered by Any-LLM reviewer_');
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
  lines.push('> _Powered by Any-LLM reviewer_');

  return lines.join('\n');
}

/**
 * Build an inline comment body for a single finding (GitLab discussion).
 */
function buildFindingComment(finding: Finding): string {
  const emojiMap: Record<string, string> = {
    CRITICAL: '🔴',
    HIGH: '🟠',
    MEDIUM: '🔵',
    LOW: '⚪',
  };
  const emoji = emojiMap[finding.severity] || '⚪';

  const lines: string[] = [];
  lines.push(COMMENT_MARKER);
  lines.push(`**${emoji} ${finding.severity}** — ${finding.description}`);
  lines.push('');

  if (finding.suggestion) {
    lines.push('> **Suggestion:**');
    lines.push('>');
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

  return lines.join('\n');
}

/**
 * Build the summary note for GitLab MR (posted as a standalone note).
 * Includes findings that couldn't be posted inline.
 */
function buildGitLabSummaryNote(
  summary: string,
  findings: Finding[],
  config: AppConfig,
  inlinePosted: number,
  inlineFailed: number
): string {
  const lines: string[] = [];

  lines.push(COMMENT_MARKER);
  lines.push(`## AI Code Review — ${config.llm.provider}/${config.llm.model}`);
  if (config.review.vibeReview) {
    lines.push('');
    lines.push('> ✨ **Vibe Review enabled** — fixes were auto-applied to this branch where possible.');
  }
  lines.push('');
  lines.push(summary);
  lines.push('');

  if (inlinePosted > 0) {
    lines.push(`📝 **${inlinePosted} finding(s) posted as inline comments above.**`);
    if (inlineFailed > 0) {
      lines.push(`⚠️ ${inlineFailed} finding(s) could not be posted inline (listed below).`);
    }
    lines.push('');
  }

  // Only include findings in summary if they weren't posted inline
  const summaryFindings = inlinePosted > 0 && inlineFailed === 0
    ? []
    : findings;

  if (summaryFindings.length > 0) {
    const severityOrder: Finding['severity'][] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    const emojiMap: Record<string, string> = {
      CRITICAL: '🔴',
      HIGH: '🟠',
      MEDIUM: '🔵',
      LOW: '⚪',
    };

    const grouped = new Map<string, Finding[]>();
    for (const finding of summaryFindings) {
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
          const suggestionLines = finding.suggestion.split('\n');
          for (const sl of suggestionLines) {
            lines.push(`> ${sl}`);
          }
          lines.push('');
        }

        if (finding.rationale) {
          lines.push(`> _${finding.rationale}_`);
          lines.push('');
        }
      }
    }
  } else if (inlinePosted > 0) {
    lines.push('No additional findings in summary.');
    lines.push('');
  }

  lines.push('---');
  lines.push('> _Powered by Any-LLM reviewer_');

  return lines.join('\n');
}
