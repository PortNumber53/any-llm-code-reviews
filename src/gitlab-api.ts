/**
 * GitLab REST API client — zero-dependency using Node.js built-in https.
 *
 * Handles MR fetching, diff retrieval, note posting, and comment cleanup.
 */

import { httpRequest, parseUrl } from './http.js';
import type { GitLabConfig } from './types/config.js';
import type {
  MergeRequest,
  MRDiffFile,
  MRChanges,
  MRNote,
  MRDiscussion,
  Position,
  GitLabApiError,
} from './types/gitlab.js';

const COMMENT_MARKER = '<!-- niteni-review -->';

export class GitLabApiClient {
  private config: GitLabConfig;

  constructor(config: GitLabConfig) {
    this.config = config;
  }

  private get baseUrl(): string {
    return this.config.baseUrl || 'https://gitlab.com/api/v4';
  }

  private get isJobToken(): boolean {
    return this.config.token === process.env.CI_JOB_TOKEN;
  }

  private get headers(): Record<string, string> {
    // CI job tokens use Job-Token header; PATs use Private-Token
    return {
      [this.isJobToken ? 'Job-Token' : 'Private-Token']: this.config.token,
      'Content-Type': 'application/json',
    };
  }

  /**
   * URL-encode project path for GitLab API (namespace/project → namespace%2Fproject).
   */
  private get projectPath(): string {
    return encodeURIComponent(`${this.config.namespace}/${this.config.project}`);
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
      const error: GitLabApiError = {
        message: response.body,
        status: response.statusCode,
      };
      try {
        const parsed = JSON.parse(response.body);
        error.message = parsed.message || parsed.error || response.body;
      } catch {
        // Use raw body as message
      }

      // CI_JOB_TOKEN cannot access the merge requests REST API — suggest PAT
      if (response.statusCode === 404 && this.isJobToken) {
        const hint =
          `\n\n[gitlab] HINT: CI_JOB_TOKEN has limited API access and often cannot read merge requests.\n` +
          `       Create a GitLab Personal Access Token (PAT) or Project Access Token with 'api' scope,\n` +
          `       and add it as a protected CI/CD variable named GITLAB_TOKEN in your project settings.\n` +
          `       The tool will use GITLAB_TOKEN before falling back to CI_JOB_TOKEN.`;
        throw new Error(`GitLab API error ${response.statusCode}: ${error.message}${hint}`);
      }

      throw new Error(`GitLab API error ${response.statusCode}: ${error.message}`);
    }

    if (response.statusCode === 204) {
      return {} as T;
    }

    return JSON.parse(response.body) as T;
  }

  /**
   * Fetch merge request metadata.
   */
  async getMergeRequest(): Promise<MergeRequest> {
    const endpoint = `/projects/${this.projectPath}/merge_requests/${this.config.mergeRequestIid}`;
    console.log(`[gitlab] GET ${this.baseUrl}${endpoint}`);
    return this.apiRequest<MergeRequest>('GET', endpoint);
  }

  /**
   * Fetch MR changes (diffs).
   */
  async getMRChanges(): Promise<MRChanges> {
    return this.apiRequest<MRChanges>(
      'GET',
      `/projects/${this.projectPath}/merge_requests/${this.config.mergeRequestIid}/changes`
    );
  }

  /**
   * Post a note (comment) on the merge request.
   */
  async postNote(body: string): Promise<unknown> {
    return this.apiRequest(
      'POST',
      `/projects/${this.projectPath}/merge_requests/${this.config.mergeRequestIid}/notes`,
      JSON.stringify({ body })
    );
  }

  /**
   * List notes on the merge request.
   */
  async listNotes(perPage = 100): Promise<MRNote[]> {
    return this.apiRequest<MRNote[]>(
      'GET',
      `/projects/${this.projectPath}/merge_requests/${this.config.mergeRequestIid}/notes?per_page=${perPage}`
    );
  }

  /**
   * Delete a note by ID.
   */
  async deleteNote(noteId: number): Promise<void> {
    await this.apiRequest(
      'DELETE',
      `/projects/${this.projectPath}/merge_requests/${this.config.mergeRequestIid}/notes/${noteId}`
    );
  }

  /**
   * Create a discussion (can be inline with position data).
   */
  async createDiscussion(body: string, position?: Position): Promise<MRDiscussion> {
    const payload: Record<string, unknown> = { body };
    if (position) {
      payload.position = position;
    }
    return this.apiRequest<MRDiscussion>(
      'POST',
      `/projects/${this.projectPath}/merge_requests/${this.config.mergeRequestIid}/discussions`,
      JSON.stringify(payload)
    );
  }

  /**
   * List discussions on the merge request.
   */
  async listDiscussions(perPage = 100): Promise<MRDiscussion[]> {
    return this.apiRequest<MRDiscussion[]>(
      'GET',
      `/projects/${this.projectPath}/merge_requests/${this.config.mergeRequestIid}/discussions?per_page=${perPage}`
    );
  }

  /**
   * Delete a discussion by ID.
   */
  async deleteDiscussion(discussionId: string): Promise<void> {
    await this.apiRequest(
      'DELETE',
      `/projects/${this.projectPath}/merge_requests/${this.config.mergeRequestIid}/discussions/${discussionId}`
    );
  }

  /**
   * Resolve a discussion.
   */
  async resolveDiscussion(discussionId: string): Promise<void> {
    await this.apiRequest(
      'PUT',
      `/projects/${this.projectPath}/merge_requests/${this.config.mergeRequestIid}/discussions/${discussionId}`,
      JSON.stringify({ resolved: true })
    );
  }

  /**
   * Clean up old review notes and discussions.
   */
  async cleanupOldReviews(): Promise<number> {
    let deleted = 0;

    // Clean up discussions (inline comments)
    try {
      const discussions = await this.listDiscussions();
      for (const discussion of discussions) {
        const hasMarker = discussion.notes.some(note =>
          note.body.includes(COMMENT_MARKER) && !note.system
        );
        if (hasMarker) {
          try {
            await this.deleteDiscussion(discussion.id);
            deleted++;
          } catch (err) {
            console.error(`Failed to delete discussion ${discussion.id}:`, err);
          }
        }
      }
    } catch (err) {
      console.error('Failed to list discussions:', err);
    }

    // Clean up standalone notes (summary comments without position)
    try {
      const notes = await this.listNotes();
      for (const note of notes) {
        if (note.body.includes(COMMENT_MARKER) && !note.system) {
          try {
            await this.deleteNote(note.id);
            deleted++;
          } catch (err) {
            console.error(`Failed to delete note ${note.id}:`, err);
          }
        }
      }
    } catch (err) {
      console.error('Failed to list notes:', err);
    }

    return deleted;
  }

  /**
   * Assemble a diff string from MR change files.
   * Mimics git diff output format for compatibility with the reviewer.
   */
  assembleDiffFromChanges(changes: MRDiffFile[]): string {
    const parts: string[] = [];
    for (const file of changes) {
      if (file.diff) {
        const oldPath = file.old_path || file.new_path;
        const newPath = file.new_path || file.old_path;
        parts.push(`diff --git a/${oldPath} b/${newPath}`);
        if (file.new_file) {
          parts.push(`--- /dev/null`);
          parts.push(`+++ b/${newPath}`);
        } else if (file.deleted_file) {
          parts.push(`--- a/${oldPath}`);
          parts.push(`+++ /dev/null`);
        } else {
          parts.push(`--- a/${oldPath}`);
          parts.push(`+++ b/${newPath}`);
        }
        parts.push(file.diff);
      }
    }
    return parts.join('\n');
  }
}
