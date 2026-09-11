-- A synthetic store at schema version 3.
-- The conversation row has the columns version 3 added and the checkpoint item has lost
-- its format, both still under the names version 11 renames. Versions 4 through 8 are
-- this same shape: the migration map names no step for any of them, so what a build
-- between them wrote differs only in tables the current statements create.
-- Every value here is made up: no real title, branch, or transcript.

CREATE TABLE schema_version (version INTEGER NOT NULL);
INSERT INTO schema_version (version) VALUES (3);

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
  next_history_sequence INTEGER NOT NULL DEFAULT 1,
  history_cleared_at INTEGER,
  kind TEXT NOT NULL DEFAULT 'main',
  archived_at INTEGER,
  archive_reason TEXT,
  pinned_at INTEGER,
  last_activity_at INTEGER NOT NULL DEFAULT 0,
  next_transcript_sequence INTEGER NOT NULL DEFAULT 1
);
INSERT INTO conversations (
  session_key, agent_id, name, created_at, next_history_sequence, history_cleared_at,
  kind, archived_at, archive_reason, pinned_at, last_activity_at, next_transcript_sequence
) VALUES ('agent:main:main', 'main', 'main', 1800000000000, 2, 1799999999999, 'main', NULL, NULL, NULL, 1800000002000, 1);

CREATE TABLE conversation_sessions (
  session_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL REFERENCES conversations(session_key),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  reset_cleared_at INTEGER,
  reset_generation_id TEXT,
  checkpoint_format TEXT
);
CREATE UNIQUE INDEX conversation_sessions_one_standing ON conversation_sessions(session_key);
INSERT INTO conversation_sessions (session_id, session_key, created_at, expires_at, checkpoint_format)
  VALUES ('gen-fixture', 'agent:main:main', 1800000001000, 1801209600000, 'tool-loop@1:openai-responses-input/1');

CREATE TABLE runtime_checkpoints (
  session_id TEXT NOT NULL REFERENCES conversation_sessions(session_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  item TEXT NOT NULL,
  PRIMARY KEY (session_id, sequence)
);
INSERT INTO runtime_checkpoints (session_id, sequence, item) VALUES ('gen-fixture', 0, '{"type":"message","role":"user","content":"synthetic"}');

CREATE TABLE history_events (
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
CREATE UNIQUE INDEX history_events_by_key ON history_events(session_key, event_key);
CREATE INDEX history_events_by_time ON history_events(session_key, recorded_at, sequence);
CREATE UNIQUE INDEX history_events_once_published
  ON history_events(session_key, request_id, kind) WHERE request_id IS NOT NULL;
INSERT INTO history_events (session_key, sequence, session_id, event_key, kind, words, recorded_at, payload)
  VALUES ('agent:main:main', 1, 'gen-fixture', 'line-1', 'said', 'synthetic line', 1800000002000,
    '{"entryId":"line-1","kind":"said","words":"synthetic line","at":1800000002000}');

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
  performed_acts INTEGER NOT NULL,
  unknown_acts INTEGER NOT NULL,
  ask_recorded_at INTEGER,
  history_recorded_at INTEGER
);
CREATE INDEX requests_by_session ON requests(session_id, ordinal);
INSERT INTO requests (
  run_id, session_id, ordinal, submission_id, origin, question, status, revision,
  accepted_at, started_at, settled_at, text, failure, performed_acts, unknown_acts, ask_recorded_at, history_recorded_at
) VALUES ('run-1', 'gen-fixture', 0, 'submission-run-1', 'spoken', 'synthetic ask', 'succeeded', 1,
  1800000001100, 1800000001200, 1800000001300, 'synthetic answer', NULL, 0, 0, NULL, NULL);
