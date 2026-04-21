// GitHub API types

export interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  head: {
    sha: string;
    ref: string;
  };
  base: {
    sha: string;
    ref: string;
  };
  diff_url: string;
  html_url: string;
}

export interface PRFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
  blob_url: string;
  raw_url: string;
}

export interface DiffPosition {
  /** Commit SHA of the PR head */
  head_sha: string;
  /** Commit SHA of the PR base */
  base_sha: string;
  /** Commit SHA of the start of the change range */
  start_sha: string;
  /** File path */
  path: string;
  /** Line number in the new version (for additions) */
  line?: number;
  /** Side of the change */
  side?: 'LEFT' | 'RIGHT';
  /** Line number in old version (for deletions) */
  start_line?: number;
  /** Side of the start of the change range */
  start_side?: 'LEFT' | 'RIGHT';
}

export interface PRReviewComment {
  /** Commit SHA */
  commit_id: string;
  /** File path */
  path: string;
  /** Line number */
  line: number;
  /** Comment body */
  body: string;
  /** Side (LEFT for deletions, RIGHT for additions) */
  side: 'LEFT' | 'RIGHT';
}

export interface PRReview {
  /** Commit SHA to review */
  commit_id: string;
  /** Review body (summary) */
  body: string;
  /** Review event type */
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  /** Inline comments */
  comments?: PRReviewComment[];
}

export interface ExistingReviewComment {
  id: number;
  body: string;
  user: {
    login: string;
    type: string;
  };
  created_at: string;
  path: string;
  line: number | null;
  html_url: string;
}

export interface GitHubApiError {
  message: string;
  documentation_url?: string;
  status?: number;
}
