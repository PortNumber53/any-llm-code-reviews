/**
 * GitHub REST API client — zero-dependency using Node.js built-in https.
 *
 * Handles PR fetching, diff retrieval, review posting, and comment cleanup.
 */

import { httpRequest, parseUrl } from './http.js';
import type { GitHubConfig } from './types/config.js';
import type {
  PullRequest,
  PRFile,
  PRReview,
  ExistingReviewComment,
  GitHubApiError,
} from './types/github.js';

const COMMENT_MARKER = '<!-- niteni-review -->';

export class GitHubApiClient {
  private config: GitHubConfig;

  constructor(config: GitHubConfig) {
    this.config = config;
  }

  private get baseUrl(): string {
    return this.config.baseUrl || 'https://api.github.com';
  }

  private get headers(): Record<string, string> {
    return {
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${this.config.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'any-llm-reviewer/0.1.0',
    };
  }

  /**
   * Generic API request helper.
   */
  private async apiRequest<T>(
    method: string,
    endpoint: string,
    body?: string
  ): Promise<T> {
    const { hostname, path } = parseUrl(`${this.baseUrl}${endpoint}`);

    const response = await httpRequest({
      hostname,
      path,
      method,
      headers: this.headers,
      body,
    });

    if (response.statusCode >= 400) {
      const error: GitHubApiError = {
        message: response.body,
        status: response.statusCode,
      };
      try {
        const parsed = JSON.parse(response.body);
        error.message = parsed.message || response.body;
        error.documentation_url = parsed.documentation_url;
      } catch {
        // Use raw body as message
      }
      throw new Error(`GitHub API error ${response.statusCode}: ${error.message}`);
    }

    return JSON.parse(response.body) as T;
  }

  /**
   * Fetch pull request metadata.
   */
  async getPullRequest(): Promise<PullRequest> {
    return this.apiRequest<PullRequest>(
      'GET',
      `/repos/${this.config.owner}/${this.config.repo}/pulls/${this.config.pullNumber}`
    );
  }

  /**
   * Fetch changed files with patches (diffs).
   * GitHub paginates at 30 files per page by default.
   */
  async getPRFiles(perPage = 100): Promise<PRFile[]> {
    return this.apiRequest<PRFile[]>(
      'GET',
      `/repos/${this.config.owner}/${this.config.repo}/pulls/${this.config.pullNumber}/files?per_page=${perPage}`
    );
  }

  /**
   * Submit a PR review with optional inline comments.
   */
  async submitReview(review: PRReview): Promise<unknown> {
    return this.apiRequest(
      'POST',
      `/repos/${this.config.owner}/${this.config.repo}/pulls/${this.config.pullNumber}/reviews`,
      JSON.stringify(review)
    );
  }

  /**
   * Post a standalone PR review comment (not inline).
   */
  async postComment(body: string): Promise<unknown> {
    return this.apiRequest(
      'POST',
      `/repos/${this.config.owner}/${this.config.repo}/issues/${this.config.pullNumber}/comments`,
      JSON.stringify({ body })
    );
  }

  /**
   * List existing review comments on the PR.
   */
  async listReviewComments(perPage = 100): Promise<ExistingReviewComment[]> {
    return this.apiRequest<ExistingReviewComment[]>(
      'GET',
      `/repos/${this.config.owner}/${this.config.repo}/pulls/${this.config.pullNumber}/comments?per_page=${perPage}`
    );
  }

  /**
   * List issue comments (non-inline) on the PR.
   */
  async listIssueComments(perPage = 100): Promise<ExistingReviewComment[]> {
    return this.apiRequest<ExistingReviewComment[]>(
      'GET',
      `/repos/${this.config.owner}/${this.config.repo}/issues/${this.config.pullNumber}/comments?per_page=${perPage}`
    );
  }

  /**
   * Delete a comment by ID.
   */
  async deleteComment(commentId: number): Promise<void> {
    await this.apiRequest(
      'DELETE',
      `/repos/${this.config.owner}/${this.config.repo}/issues/comments/${commentId}`
    );
  }

  /**
   * Delete a PR review comment by ID.
   */
  async deleteReviewComment(commentId: number): Promise<void> {
    await this.apiRequest(
      'DELETE',
      `/repos/${this.config.owner}/${this.config.repo}/pulls/comments/${commentId}`
    );
  }

  /**
   * Clean up old review comments from the bot.
   */
  async cleanupOldReviews(): Promise<number> {
    let deleted = 0;

    // Clean up issue comments (general review summary)
    try {
      const issueComments = await this.listIssueComments();
      for (const comment of issueComments) {
        if (comment.body.includes(COMMENT_MARKER) && comment.user.type === 'Bot') {
          try {
            await this.deleteComment(comment.id);
            deleted++;
          } catch (err) {
            console.error(`Failed to delete comment ${comment.id}:`, err);
          }
        }
      }
    } catch (err) {
      console.error('Failed to list issue comments:', err);
    }

    return deleted;
  }

  /**
   * Assemble a diff string from PR files.
   * Mimics git diff output format.
   */
  assembleDiffFromFiles(files: PRFile[]): string {
    const parts: string[] = [];
    for (const file of files) {
      if (!file.patch) continue;
      parts.push(`diff --git a/${file.filename} b/${file.filename}`);
      parts.push(`--- a/${file.filename}`);
      parts.push(`+++ b/${file.filename}`);
      parts.push(file.patch);
    }
    return parts.join('\n');
  }
}
