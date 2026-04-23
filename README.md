# any-llm-code-reviews

AI-powered code review tool for **GitHub** pull requests and **GitLab** merge requests with multi-LLM support.
Replicates [niteni](https://github.com/denyherianto/niteni)'s clean architecture,
extended to support **NVIDIA NIM**, Google **Gemini**, **OpenAI**, and **Anthropic Claude**.

The name _niteni_ comes from Javanese meaning "to observe carefully."

## Features

- **2 platforms** — GitHub (PRs) and GitLab (MRs)
- **4 LLM providers** — NVIDIA NIM (default), Gemini, OpenAI, Anthropic
- **Structured output** — JSON schema enforcement for reliable findings
- **Inline comments** — Posts findings with severity, file, line, and suggestions
- **Diff filtering** — Include/exclude glob patterns, size limits
- **Auto-cleanup** — Removes old bot comments before posting new review
- **Zero dependencies** — Only Node.js built-in modules (https, child_process, fs, path)
- **3 review modes** — PR/MR review, local diff review, simulation demo

## Quick Start

### 1. Install

```bash
git clone <repo-url>
cd any-llm-code-reviews
npm ci && npm run build
```

### 2. Run locally

```bash
# Simulation mode (no API keys needed)
node dist/cli.js --mode simulate

# Local diff review with NVIDIA
NVIDIA_API_KEY=nvapi-xxx node dist/cli.js --mode diff --provider nvidia --target main

# GitHub PR review
GITHUB_TOKEN=ghp_xxx \
GITHUB_REPO_OWNER=myorg \
GITHUB_REPO_NAME=myrepo \
NVIDIA_API_KEY=nvapi-xxx \
node dist/cli.js --mode pr --pr 42

# GitLab MR review
GITLAB_TOKEN=glpat-xxx \
GITLAB_NAMESPACE=myorg \
GITLAB_PROJECT=myrepo \
NVIDIA_API_KEY=nvapi-xxx \
node dist/cli.js --mode pr --platform gitlab --mr 7
```

### 3. Add to CI/CD

**GitHub Actions:** Copy `.github/workflows/ai-review.yml` to your repo.
Add your API key as a repository secret (e.g., `NVIDIA_API_KEY`).

**GitLab CI/CD:** The `.gitlab-ci.yml` already includes an `ai-code-review` job.
Add the following CI/CD variables in **Settings → CI/CD → Variables**:
- `GITLAB_TOKEN` — GitLab PAT with `api` scope
- `NVIDIA_API_KEY` (or `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)

## Supported LLM Providers

| Provider   | Default Model                      | API Key Env Var      | Base URL                                       |
|------------|------------------------------------|----------------------|------------------------------------------------|
| NVIDIA     | `meta/llama-3.3-70b-instruct`     | `NVIDIA_API_KEY`     | `https://integrate.api.nvidia.com/v1`           |
| Gemini     | `gemini-2.0-flash`                | `GEMINI_API_KEY`     | `https://generativelanguage.googleapis.com/v1beta` |
| OpenAI     | `gpt-4o`                          | `OPENAI_API_KEY`     | `https://api.openai.com/v1`                     |
| Anthropic  | `claude-sonnet-4-20250514`        | `ANTHROPIC_API_KEY`  | `https://api.anthropic.com/v1`                  |

### NVIDIA Models

NVIDIA NIM provides access to open-source models via an OpenAI-compatible API:

- `meta/llama-3.3-70b-instruct` — Best general-purpose
- `meta/llama-3.1-405b-instruct` — Largest, most capable
- `mistralai/mixtral-8x22b-instruct-v0.1` — Fast MoE architecture
- `nvidia/nemotron-4-340b-instruct` — NVIDIA's own model

### Custom Base URLs

Override the API base URL for self-hosted or proxy endpoints:

```bash
NVIDIA_BASE_URL=https://my-nim-proxy.example.com/v1
```

## CLI Reference

```
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
  --model <model>     Model name (overrides env var)
  --pr <number>       Pull request number (GitHub)
  --mr <iid>          Merge request IID (GitLab)
  --target <branch>   Target branch for diff mode (default: main)
  --help              Show this help
```

## Environment Variables

| Variable                       | Default  | Description                              |
|--------------------------------|----------|------------------------------------------|
| `PLATFORM`                     | `github` | Platform: github, gitlab                 |
| `GITHUB_TOKEN`                 | Required*| GitHub PAT (for GitHub PR mode)          |
| `GITHUB_REPO_OWNER`            | Required*| Repository owner                         |
| `GITHUB_REPO_NAME`             | Required*| Repository name                          |
| `GITHUB_PR_NUMBER`             | Required*| PR number (can use `--pr`)               |
| `GITLAB_TOKEN`                 | Required*| GitLab PAT or CI job token (for GitLab MR mode) |
| `GITLAB_NAMESPACE`             | Required*| Project namespace/group (or `CI_PROJECT_NAMESPACE`) |
| `GITLAB_PROJECT`               | Required*| Project name (or `CI_PROJECT_NAME`)      |
| `GITLAB_MR_IID`                | Required*| MR IID (or `CI_MERGE_REQUEST_IID`, can use `--mr`) |
| `GITLAB_API_URL`               | *(auto)* | GitLab API v4 URL (or `CI_API_V4_URL`)   |
| `LLM_PROVIDER`                 | `nvidia` | Provider: nvidia, gemini, openai, anthropic |
| `NVIDIA_API_KEY`               | —        | NVIDIA API key                           |
| `GEMINI_API_KEY`               | —        | Google Gemini API key                    |
| `OPENAI_API_KEY`               | —        | OpenAI API key                           |
| `ANTHROPIC_API_KEY`            | —        | Anthropic API key                        |
| `LLM_TEMPERATURE`              | `0.2`    | Generation temperature                   |
| `LLM_MAX_TOKENS`               | `8192`   | Max output tokens                        |
| `REVIEW_MAX_FILES`             | `50`     | Max files to review                      |
| `REVIEW_MAX_DIFF_SIZE`         | `100000` | Max diff size in chars                   |
| `REVIEW_INCLUDE_PATTERNS`      | —        | Comma-separated globs to include         |
| `REVIEW_EXCLUDE_PATTERNS`      | *(see)*  | Comma-separated globs to exclude         |
| `REVIEW_POST_AS_COMMENT`       | `true`   | Post review as PR comment                |
| `REVIEW_FAIL_ON_CRITICAL`      | `false`  | Exit 1 on CRITICAL findings              |

## Severity Levels

| Level    | Emoji | Examples                                        |
|----------|-------|-------------------------------------------------|
| CRITICAL |  Red  | Security vulnerabilities, data loss, logic failures |
| HIGH     | Orange| Performance issues, functional bugs             |
| MEDIUM   | Blue  | Validation gaps, error handling                 |
| LOW      | White | Documentation, style, readability               |

## How It Works

1. **Fetch** — Gets PR/MR metadata and changed file patches from GitHub/GitLab API
2. **Filter** — Applies include/exclude patterns and enforces diff size limit
3. **Review** — Sends filtered diff to LLM with structured JSON output schema
4. **Validate** — Checks all findings have required fields (severity, file, line, description)
5. **Post** — Cleans up old bot comments/notes, posts new review summary

## Architecture

```
src/
  cli.ts              Entry point — arg parsing, mode dispatch
  config.ts           Env var parsing and validation
  index.ts            Orchestration — PR/MR review and diff review flows
  reviewer.ts         Diff filtering and finding validation
  github-api.ts       GitHub REST API client (zero dep)
  gitlab-api.ts       GitLab REST API client (zero dep)
  http.ts             HTTPS request helper (zero dep)
  types/              TypeScript type definitions
    config.ts         AppConfig, LLMConfig, GitHubConfig, GitLabConfig
    github.ts         PR, file, comment types
    gitlab.ts         MR, diff, note types
    reviewer.ts       Finding, severity, review result types
    llm.ts            LLM provider interface, schema, prompt
  providers/          LLM provider implementations
    nvidia.ts         NVIDIA NIM (OpenAI-compatible)
    gemini.ts         Google Gemini REST API
    openai.ts         OpenAI chat completions
    anthropic.ts      Anthropic Messages API with tool use
    index.ts          Provider factory
```

## Credits

- Inspired by [niteni](https://github.com/denyherianto/niteni) by Deny Herianto
- Extended with NVIDIA NIM support and multi-provider architecture
- Name: _niteni_ (Javanese) — "to observe carefully"

## License

MIT
