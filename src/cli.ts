/**
 * CLI entry point — parses args and dispatches to the appropriate mode.
 *
 * Modes:
 *   --mode pr       (default) Review a GitHub pull request or GitLab merge request
 *   --mode diff     Review a local git diff
 *   --mode simulate Run with mock data (demo mode)
 *
 * Platform selection:
 *   --platform github|gitlab   (or set PLATFORM env var)
 *
 * Provider selection:
 *   --provider nvidia|gemini|openai|anthropic   (or set LLM_PROVIDER env var)
 *
 * Model override:
 *   --model <model-name>   Auto-detects provider from model name when possible.
 *                          Known prefixes: claude-xxx (anthropic), gpt-xxx/o1/o3-xxx (openai),
 *                          gemini-xxx (gemini), meta/xxx/mistralai/xxx/deepseek-ai/xxx (nvidia).
 *                          If the model name is not recognized, falls back to --provider / LLM_PROVIDER.
 *
 * PR number (GitHub):
 *   --pr <number>   (or set GITHUB_PR_NUMBER env var)
 *
 * MR IID (GitLab):
 *   --mr <iid>   (or set GITLAB_MR_IID / CI_MERGE_REQUEST_IID env var)
 *
 * Target branch (for diff mode):
 *   --target <branch>   (default: main)
 */

import { loadConfig } from './config.js';
import { runPullRequestReview, runMergeRequestReview, runDiffReview } from './index.js';
import { SEVERITY_EMOJI } from './types/reviewer.js';
import type { ReviewResult } from './types/reviewer.js';

const VALID_MODES = ['pr', 'diff', 'simulate'];
const VALID_PROVIDERS = ['gemini', 'nvidia', 'openai', 'anthropic'];
const VALID_PLATFORMS = ['github', 'gitlab'];

function printUsage(): void {
  console.log(`
Any-LLM reviewer — AI code review tool with multi-LLM support

Usage:
  node dist/cli.js [options]

Modes:
  --mode pr        Review a GitHub PR or GitLab MR (default)
  --mode diff      Review a local git diff
  --mode simulate  Run with mock data (demo)

Options:
  --platform <name>   Platform: github (default), gitlab
  --provider <name>   LLM provider: nvidia (default), gemini, openai, anthropic
  --model <model>     Model name (auto-detects provider; overrides env var)
  --pr <number>       Pull request number (GitHub)
  --mr <iid>          Merge request IID (GitLab)
  --target <branch>   Target branch for diff mode (default: main)
  --help              Show this help

Model Auto-Detection (--model auto-selects provider):
  NVIDIA:    meta/*, mistralai/*, deepseek-ai/*, nvidia/*
  Gemini:    gemini-*
  OpenAI:    gpt-*, o1, o3-*, chatgpt-*
  Anthropic: claude-*

Environment Variables (GitHub):
  GITHUB_TOKEN                 GitHub PAT (required for PR mode on GitHub)
  GITHUB_REPO_OWNER            Repository owner
  GITHUB_REPO_NAME             Repository name
  GITHUB_PR_NUMBER             PR number (can use --pr instead)

Environment Variables (GitLab):
  GITLAB_TOKEN                 GitLab PAT or CI job token (required for PR mode on GitLab)
  GITLAB_NAMESPACE             Project namespace/group (or CI_PROJECT_NAMESPACE)
  GITLAB_PROJECT               Project name (or CI_PROJECT_NAME)
  GITLAB_MR_IID                Merge request IID (or CI_MERGE_REQUEST_IID, can use --mr)
  GITLAB_API_URL               GitLab API v4 URL (or CI_API_V4_URL)

Environment Variables (LLM):
  PLATFORM                     Platform: github, gitlab
  LLM_PROVIDER                 Provider: nvidia, gemini, openai, anthropic
  NVIDIA_API_KEY               NVIDIA API key
  GEMINI_API_KEY               Google Gemini API key
  OPENAI_API_KEY               OpenAI API key
  ANTHROPIC_API_KEY            Anthropic API key
  NVIDIA_MODEL                 NVIDIA model name (default: meta/llama-3.3-70b-instruct)
  GEMINI_MODEL                 Gemini model name (default: gemini-2.0-flash)
  OPENAI_MODEL                 OpenAI model name (default: gpt-4o)
  ANTHROPIC_MODEL              Anthropic model name (default: claude-sonnet-4-20250514)
  NVIDIA_BASE_URL              Custom NVIDIA API URL
  LLM_TEMPERATURE              Temperature (default: 0.2)
  LLM_MAX_TOKENS               Max output tokens (default: 8192)
  REVIEW_MAX_FILES             Max files to review (default: 50)
  REVIEW_MAX_DIFF_SIZE         Max diff size in chars (default: 100000)
  REVIEW_INCLUDE_PATTERNS      Comma-separated globs to include
  REVIEW_EXCLUDE_PATTERNS      Comma-separated globs to exclude
  REVIEW_POST_AS_COMMENT       Post review as comment (default: true)
  REVIEW_FAIL_ON_CRITICAL      Exit 1 on CRITICAL (default: false)

Examples:
  # Review GitHub PR #42 with NVIDIA Llama
  NVIDIA_API_KEY=... GITHUB_TOKEN=... \\
  GITHUB_REPO_OWNER=myorg GITHUB_REPO_NAME=myrepo \\
  node dist/cli.js --mode pr --provider nvidia --pr 42

  # Review GitLab MR !7 with OpenAI
  OPENAI_API_KEY=... GITLAB_TOKEN=... \\
  GITLAB_NAMESPACE=myorg GITLAB_PROJECT=myrepo \\
  node dist/cli.js --mode pr --platform gitlab --provider openai --mr 7

  # Model auto-detection (provider inferred from model name)
  ANTHROPIC_API_KEY=... node dist/cli.js --mode pr --model claude-sonnet-4-20250514 --pr 42
  OPENAI_API_KEY=... node dist/cli.js --mode pr --model gpt-4o-mini --pr 42

  # Review local diff with OpenAI
  OPENAI_API_KEY=... node dist/cli.js --mode diff --provider openai --target main

  # Demo mode (no API keys needed)
  node dist/cli.js --mode simulate
`);
}

function parseArgs(): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = argv[i + 1];
      if (nextArg && !nextArg.startsWith('--')) {
        args[key] = nextArg;
        i++;
      } else {
        args[key] = true;
      }
    }
  }

  return args;
}

async function runSimulate(): Promise<ReviewResult> {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   Any-LLM reviewer — Simulation Mode        ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  const mockFindings = [
    {
      severity: 'CRITICAL' as const,
      file: 'src/auth/jwt.ts',
      line: 42,
      description: 'JWT secret is hardcoded in source code. This exposes the secret to anyone with repository access.',
      suggestion: 'Move the secret to an environment variable:\n  const secret = process.env.JWT_SECRET;',
      rationale: 'Hardcoded secrets are a security vulnerability that can lead to token forgery.',
    },
    {
      severity: 'HIGH' as const,
      file: 'src/api/users.ts',
      line: 118,
      description: 'SQL query uses string concatenation instead of parameterized queries.',
      suggestion: 'Use parameterized query:\n  db.query("SELECT * FROM users WHERE id = $1", [userId])',
      rationale: 'String concatenation is vulnerable to SQL injection attacks.',
    },
    {
      severity: 'MEDIUM' as const,
      file: 'src/utils/validate.ts',
      line: 25,
      description: 'Email validation regex does not handle all valid email formats (e.g., plus addressing).',
      suggestion: 'Use a well-tested regex or the built-in URL API for validation.',
    },
    {
      severity: 'LOW' as const,
      file: 'README.md',
      line: 10,
      description: 'API endpoint documentation is missing the new /health endpoint.',
      suggestion: 'Add documentation for the /health endpoint.',
    },
  ];

  const mockResult: ReviewResult = {
    summary: 'Reviewed 8 files with 4 findings (1 CRITICAL, 1 HIGH, 1 MEDIUM, 1 LOW). The critical finding involves a hardcoded JWT secret that must be addressed before merge.',
    findings: mockFindings,
    hasCritical: true,
    provider: 'simulate',
    model: 'mock-v1',
  };

  // Print with color
  const RESET = '\x1b[0m';
  const BOLD = '\x1b[1m';
  const DIM = '\x1b[2m';
  const RED = '\x1b[31m';
  const YELLOW = '\x1b[33m';
  const BLUE = '\x1b[34m';
  const WHITE = '\x1b[37m';

  console.log(`${BOLD}Review Summary${RESET}`);
  console.log(mockResult.summary);
  console.log('');

  for (const finding of mockResult.findings) {
    const colors: Record<string, string> = {
      CRITICAL: RED,
      HIGH: YELLOW,
      MEDIUM: BLUE,
      LOW: WHITE,
    };
    const color = colors[finding.severity] || WHITE;
    const emoji = SEVERITY_EMOJI[finding.severity];

    console.log(`${color}${emoji} ${BOLD}${finding.severity}${RESET} ${finding.file}:${finding.line}`);
    console.log(`  ${finding.description}`);
    if (finding.suggestion) {
      console.log(`  ${DIM}Suggestion: ${finding.suggestion}${RESET}`);
    }
    console.log('');
  }

  return mockResult;
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const mode = (args.mode as string) || 'pr';

  if (!VALID_MODES.includes(mode)) {
    console.error(`Error: Invalid mode "${mode}". Valid modes: ${VALID_MODES.join(', ')}`);
    printUsage();
    process.exit(1);
  }

  // Handle simulate mode separately (no config needed)
  if (mode === 'simulate') {
    const result = await runSimulate();
    if (result.hasCritical && args.failOnCritical) {
      process.exit(1);
    }
    process.exit(0);
  }

  // Load config
  try {
    const config = loadConfig(args);
    let result: ReviewResult;

    if (mode === 'pr') {
      if (config.platform === 'gitlab') {
        result = await runMergeRequestReview(config);
      } else {
        result = await runPullRequestReview(config);
      }
    } else {
      const target = (args.target as string) || 'main';
      result = await runDiffReview(config, target);
    }

    // Print result
    console.log('\n═══════════════════════════════════════');
    console.log(`Provider: ${result.provider} / Model: ${result.model}`);
    console.log(`Findings: ${result.findings.length}`);
    console.log(`Critical: ${result.hasCritical ? 'YES' : 'no'}`);
    console.log('═══════════════════════════════════════\n');

    console.log(result.summary);

    for (const finding of result.findings) {
      const emoji = SEVERITY_EMOJI[finding.severity];
      console.log(`\n${emoji} ${finding.severity} — ${finding.file}:${finding.line}`);
      console.log(`  ${finding.description}`);
      if (finding.suggestion) {
        console.log(`  Suggestion: ${finding.suggestion}`);
      }
    }

    if (result.hasCritical && config.review.failOnCritical) {
      console.error('\n❌ CRITICAL findings detected. Failing.');
      process.exit(1);
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
