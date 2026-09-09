CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE pull_requests (id TEXT PRIMARY KEY, url TEXT NOT NULL);
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  branch TEXT,
  updated_at INTEGER NOT NULL,
  project_id TEXT,
  pull_request_id TEXT,
  type TEXT NOT NULL,
  archived_at INTEGER,
  worktree_path TEXT
);
CREATE TABLE terminal_agent_bindings (
  workspace_id TEXT NOT NULL,
  agent_id TEXT,
  agent_session_id TEXT,
  terminal_id TEXT,
  ended_at INTEGER,
  last_event_at INTEGER
);
CREATE TABLE host_agent_configs (preset_id TEXT, display_order INTEGER);

INSERT INTO projects (id, name) VALUES ('project-luke', 'luke');
INSERT INTO pull_requests (id, url) VALUES ('pull-1', 'https://github.com/reviewstage/luke/pull/1');
INSERT INTO host_agent_configs (preset_id, display_order) VALUES ('claude', 1), ('codex', 2);

INSERT INTO workspaces (id, name, branch, updated_at, project_id, pull_request_id, type, archived_at, worktree_path)
VALUES ('workspace-notch', 'notch-panel', 'luke-notch-panel', 1788253140000, 'project-luke', 'pull-1', 'worktree', NULL, '/Users/dev/worktrees/notch-panel');
INSERT INTO workspaces (id, name, branch, updated_at, project_id, pull_request_id, type, archived_at, worktree_path)
VALUES ('workspace-idle', 'flaky-check', 'luke-flaky-check', 1788253020000, 'project-luke', NULL, 'worktree', NULL, '/Users/dev/worktrees/flaky-check');
INSERT INTO workspaces (id, name, branch, updated_at, project_id, pull_request_id, type, archived_at, worktree_path)
VALUES ('workspace-main', 'luke', 'main', 1788252900000, 'project-luke', NULL, 'main', NULL, NULL);
INSERT INTO workspaces (id, name, branch, updated_at, project_id, pull_request_id, type, archived_at, worktree_path)
VALUES ('workspace-filed', 'old-panel', 'luke-old-panel', 1788252840000, 'project-luke', NULL, 'worktree', 1788252840000, '/Users/dev/worktrees/old-panel');

INSERT INTO terminal_agent_bindings (workspace_id, agent_id, agent_session_id, terminal_id, ended_at, last_event_at)
VALUES ('workspace-notch', 'claude', '0f3a1c22-6f10-4d5e-9a71-2b8c4d5e6f70', 'terminal-1', NULL, 1788253140000);
