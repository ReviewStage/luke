CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  rollout_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  model_provider TEXT NOT NULL,
  cwd TEXT NOT NULL,
  title TEXT NOT NULL,
  sandbox_policy TEXT NOT NULL,
  approval_mode TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  first_user_message TEXT NOT NULL DEFAULT '',
  created_at_ms INTEGER,
  updated_at_ms INTEGER,
  preview TEXT NOT NULL DEFAULT '',
  recency_at_ms INTEGER NOT NULL DEFAULT 0,
  git_branch TEXT,
  model TEXT,
  reasoning_effort TEXT
);
INSERT INTO threads (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, sandbox_policy, approval_mode, archived, first_user_message, created_at_ms, updated_at_ms, preview, recency_at_ms, git_branch, model, reasoning_effort) VALUES ('019b1c22-6f10-7d5e-9a71-2b8c4d5e6f70', '{{home}}/sessions/rollout-019b1c22-6f10-7d5e-9a71-2b8c4d5e6f70.jsonl', 1788253020, 1788253020, 'cli', 'openai_sse', '/Users/dev/luke', 'Fix the flaky check', 'workspace-write', 'never', 0, '', 1788253020000, 1788253020000, '', 1788253020000, 'main', 'gpt-5.6-terra', 'high');
INSERT INTO threads (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, sandbox_policy, approval_mode, archived, first_user_message, created_at_ms, updated_at_ms, preview, recency_at_ms, git_branch, model, reasoning_effort) VALUES ('019b1c22-6f10-7d5e-9a71-2b8c4d5e6f71', '{{home}}/sessions/rollout-019b1c22-6f10-7d5e-9a71-2b8c4d5e6f71.jsonl', 1788253140, 1788253140, 'cli', 'openai_sse', '/Users/dev/luke', 'Rewrite the notch panel', 'workspace-write', 'never', 0, '', 1788253140000, 1788253140000, '', 1788253140000, 'main', 'gpt-5.6-terra', 'high');
INSERT INTO threads (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, sandbox_policy, approval_mode, archived, first_user_message, created_at_ms, updated_at_ms, preview, recency_at_ms, git_branch, model, reasoning_effort) VALUES ('019b1c22-6f10-7d5e-9a71-2b8c4d5e6f72', '{{home}}/sessions/rollout-019b1c22-6f10-7d5e-9a71-2b8c4d5e6f72.jsonl.zst', 1788252900, 1788252900, 'cli', 'openai_sse', '/Users/dev/luke', 'Archived by compression', 'workspace-write', 'never', 0, '', 1788252900000, 1788252900000, '', 1788252900000, 'main', 'gpt-5.6-terra', 'high');
