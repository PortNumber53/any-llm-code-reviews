/**
 * Applier — applies vibe review fixes to local files and optionally commits in CI.
 *
 * Uses exact text matching (original → replacement) for safe substitutions.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { Finding } from './types/reviewer.js';

export interface ApplyResult {
  applied: number;
  skipped: number;
  files: string[];
  errors: string[];
}

/**
 * Apply findings that have both `original` and `replacement` fields.
 * Matches exact text in files and replaces it.
 */
export function applyFixes(findings: Finding[]): ApplyResult {
  const result: ApplyResult = { applied: 0, skipped: 0, files: [], errors: [] };

  // Group findings by file that have replacement + original
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!f.original || !f.replacement) continue;
    const list = byFile.get(f.file) || [];
    list.push(f);
    byFile.set(f.file, list);
  }

  for (const [file, fileFindings] of byFile) {
    try {
      let content = readFileSync(file, 'utf-8');
      let appliedCount = 0;

      for (const finding of fileFindings) {
        if (!finding.original || !finding.replacement) continue;

        const occurrences = content.split(finding.original).length - 1;
        if (occurrences === 0) {
          result.errors.push(`${file}:${finding.line}: original text not found`);
          result.skipped++;
          continue;
        }
        if (occurrences > 1) {
          result.errors.push(`${file}:${finding.line}: original text is ambiguous (${occurrences} matches)`);
          result.skipped++;
          continue;
        }

        content = content.replace(finding.original, finding.replacement);
        appliedCount++;
      }

      if (appliedCount > 0) {
        writeFileSync(file, content, 'utf-8');
        result.applied += appliedCount;
        result.files.push(file);
      }
    } catch (err) {
      result.errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
      result.skipped += fileFindings.length;
    }
  }

  return result;
}

/**
 * Detect if running inside a CI environment.
 */
function isCI(): boolean {
  return !!(
    process.env.CI === 'true' ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.TRAVIS ||
    process.env.JENKINS_URL
  );
}

/**
 * If running in CI, commit applied fixes and push back to the current branch.
 */
export function commitAndPushIfInCI(): void {
  if (!isCI()) {
    console.log('[vibe] Not in CI — fixes applied locally. Review and commit manually.');
    return;
  }

  try {
    // Configure git user if not already set
    const name = process.env.VIBE_REVIEW_COMMITTER_NAME || 'Vibe Review Bot';
    const email = process.env.VIBE_REVIEW_COMMITTER_EMAIL || 'vibe-review@bot.local';

    try {
      execSync('git config user.name', { stdio: 'pipe' });
    } catch {
      execSync(`git config user.name "${name}"`, { stdio: 'pipe' });
    }
    try {
      execSync('git config user.email', { stdio: 'pipe' });
    } catch {
      execSync(`git config user.email "${email}"`, { stdio: 'pipe' });
    }

    // Check if there are changes to commit
    const status = execSync('git status --porcelain', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    if (!status) {
      console.log('[vibe] No changes to commit.');
      return;
    }

    // Stage all changes
    execSync('git add -A', { stdio: 'pipe' });

    // Commit
    const commitMsg = `chore: auto-apply vibe review fixes

Focus: fixing issues in changed code only.
No new features added.`;
    execSync(`git commit -m "${commitMsg}"`, { stdio: 'pipe' });

    // Push with token-injected remote if needed
    const pushResult = pushWithCIToken();
    console.log('[vibe]', pushResult);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[vibe] Failed to commit/push:', msg);
    throw new Error(`Vibe review commit/push failed: ${msg}`);
  }
}

function pushWithCIToken(): string {
  // GitHub Actions
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) {
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    const branch = process.env.GITHUB_HEAD_REF || execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    const remoteUrl = `https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${owner}/${repo}.git`;
    execSync(`git push "${remoteUrl}" "HEAD:${branch}"`, { stdio: 'pipe' });
    return `Pushed fixes to GitHub branch: ${branch}`;
  }

  // GitLab CI
  if (process.env.GITLAB_CI && process.env.CI_JOB_TOKEN) {
    const branch = process.env.CI_COMMIT_REF_NAME || execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    const remoteUrl = process.env.CI_REPOSITORY_URL;
    if (remoteUrl) {
      const authUrl = remoteUrl.replace(/^https?:\/\//, `https://gitlab-ci-token:${process.env.CI_JOB_TOKEN}@`);
      execSync(`git push "${authUrl}" "HEAD:${branch}"`, { stdio: 'pipe' });
      return `Pushed fixes to GitLab branch: ${branch}`;
    }
  }

  // Generic fallback
  execSync('git push', { stdio: 'pipe' });
  return 'Pushed fixes to current branch.';
}
