-- A synthetic store at schema version 11.
-- The rename has happened and the run's accounting columns version 12 adds have not.
-- Every value here is made up: no real title, branch, or transcript.

CREATE TABLE schema_version (version INTEGER NOT NULL);
INSERT INTO schema_version (version) VALUES (11);

CREATE TABLE agents (
  agent_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
INSERT INTO agents (agent_id, created_at) VALUES ('main', 1800000000000);

CREATE TABLE conversations (
  session_key TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(agent_id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  next_conversation_sequence INTEGER NOT NULL DEFAULT 1,
  conversation_cleared_at INTEGER,
  kind TEXT NOT NULL DEFAULT 'main',
  archived_at INTEGER,
  archive_reason TEXT,
  pinned_at INTEGER,
  last_activity_at INTEGER NOT NULL DEFAULT 0,
  next_transcript_sequence INTEGER NOT NULL DEFAULT 1
);
INSERT INTO conversations (
  session_key, agent_id, name, created_at, next_conversation_sequence, conversation_cleared_at,
  kind, archived_at, archive_reason, pinned_at, last_activity_at, next_transcript_sequence
) VALUES ('agent:main:main', 'main', 'main', 1800000000000, 2, 1799999999999, 'main', NULL, NULL, NULL, 1800000002000, 1);

CREATE TABLE conversation_sessions (
  session_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL REFERENCES conversations(session_key),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  reset_cleared_at INTEGER,
  reset_generation_id TEXT,
  checkpoint_format TEXT,
  compaction_count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX conversation_sessions_one_standing ON conversation_sessions(session_key);
INSERT INTO conversation_sessions (session_id, session_key, created_at, expires_at, checkpoint_format, compaction_count)
  VALUES ('gen-fixture', 'agent:main:main', 1800000001000, 1801209600000, 'tool-loop@1:openai-responses-input/1', 3);

CREATE TABLE runtime_checkpoints (
  session_id TEXT NOT NULL REFERENCES conversation_sessions(session_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  item TEXT NOT NULL,
  PRIMARY KEY (session_id, sequence)
);
INSERT INTO runtime_checkpoints (session_id, sequence, item) VALUES ('gen-fixture', 0, '{"type":"message","role":"user","content":"synthetic"}');

CREATE TABLE conversation_events (
  session_key TEXT NOT NULL REFERENCES conversations(session_key),
  sequence INTEGER NOT NULL,
  session_id TEXT,
  event_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  words TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  request_id TEXT,
  provider_id TEXT,
  provider_session_id TEXT,
  payload TEXT NOT NULL,
  PRIMARY KEY (session_key, sequence)
);
CREATE UNIQUE INDEX conversation_events_by_key ON conversation_events(session_key, event_key);
CREATE INDEX conversation_events_by_time ON conversation_events(session_key, recorded_at, sequence);
CREATE UNIQUE INDEX conversation_events_once_published
  ON conversation_events(session_key, request_id, kind) WHERE request_id IS NOT NULL;
INSERT INTO conversation_events (session_key, sequence, session_id, event_key, kind, words, recorded_at, payload)
  VALUES ('agent:main:main', 1, 'gen-fixture', 'line-1', 'said', 'synthetic line', 1800000002000,
    '{"entryId":"line-1","kind":"said","words":"synthetic line","at":1800000002000}');

CREATE TABLE conversation_archives (
  archive_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL,
  encoding TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  published_at INTEGER,
  conversation_lines INTEGER NOT NULL,
  transcript_events INTEGER NOT NULL,
  previous_cutoff INTEGER,
  payload BLOB
);
INSERT INTO conversation_archives (
  archive_id, session_key, kind, name, created_at, deleted_at, encoding, sha256,
  byte_length, file_name, published_at, conversation_lines, transcript_events, previous_cutoff, payload
) VALUES ('archive-1', 'agent:main:thread:synthetic', 'thread', 'synthetic thread', 1800000000000, 1800000003000,
  'jsonl', '0000000000000000000000000000000000000000000000000000000000000000', 12,
  'agent_main_thread_synthetic.jsonl.deleted.1.archive-1', NULL, 1, 0, NULL, NULL);

CREATE TABLE requests (
  run_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES conversation_sessions(session_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  submission_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  question TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  accepted_at INTEGER NOT NULL,
  started_at INTEGER,
  settled_at INTEGER,
  text TEXT,
  failure TEXT,
  performed_actions INTEGER NOT NULL,
  unknown_actions INTEGER NOT NULL,
  ask_recorded_at INTEGER,
  conversation_recorded_at INTEGER
);
CREATE INDEX requests_by_session ON requests(session_id, ordinal);
INSERT INTO requests (
  run_id, session_id, ordinal, submission_id, origin, question, status, revision,
  accepted_at, started_at, settled_at, text, failure, performed_actions, unknown_actions, ask_recorded_at, conversation_recorded_at
) VALUES ('run-1', 'gen-fixture', 0, 'submission-run-1', 'spoken', 'synthetic ask', 'succeeded', 1,
  1800000001100, 1800000001200, 1800000001300, 'synthetic answer', NULL, 0, 0, NULL, NULL);

CREATE TABLE memory_flush_state (
  session_key TEXT PRIMARY KEY,
  generation_id TEXT NOT NULL,
  compaction_count INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  flushed_at INTEGER NOT NULL
);
INSERT INTO memory_flush_state (session_key, generation_id, compaction_count, outcome, flushed_at)
  VALUES ('agent:main:main', 'gen-fixture', 2, 'flushed', 1800000001400);
