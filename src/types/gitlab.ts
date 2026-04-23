// GitLab API types

export interface DiffRefs {
  base_sha: string;
  head_sha: string;
  start_sha: string;
}

export interface MergeRequest {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: 'opened' | 'closed' | 'merged';
  source_branch: string;
  target_branch: string;
  sha: string;
  web_url: string;
  diff_refs: DiffRefs;
}

export interface MRDiffFile {
  old_path: string;
  new_path: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
  diff: string;
}

export interface MRChanges {
  changes: MRDiffFile[];
  diff_refs: DiffRefs;
}

export interface Position {
  base_sha: string;
  head_sha: string;
  start_sha: string;
  position_type: 'text';
  new_path: string;
  new_line: number;
  old_path?: string;
  old_line?: number;
}

export interface MRNote {
  id: number;
  body: string;
  author: {
    username: string;
    name: string;
  };
  created_at: string;
  system: boolean;
  type: string | null;
  resolvable?: boolean;
  position?: Position;
}

export interface MRDiscussionNote extends MRNote {
  noteable_id: number;
  noteable_iid: number;
  noteable_type: string;
  position?: Position;
}

export interface MRDiscussion {
  id: string;
  individual_note: boolean;
  notes: MRDiscussionNote[];
}

export interface GitLabApiError {
  message: string;
  status?: number;
}
