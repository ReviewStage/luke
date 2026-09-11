-- A synthetic store at schema version 2.
-- The generation carries the checkpoint stamp version 2 gave it, and the item row still
-- carries the format column version 3 drops.
-- Every value here is made up: no real title, branch, or transcript.

CREATE TABLE schema_version (version INTEGER NOT NULL);
INSERT INTO schema_version (version) VALUES (2);

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
  history_cleared_at INTEGER
);
INSERT INTO conversations (session_key, agent_id, name, created_at, next_history_sequence, history_cleared_at)
  VALUES ('agent:main:main', 'main', 'main', 1800000000000, 2, 1799999999999);

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
  format TEXT NOT NULL,
  item TEXT NOT NULL,
  PRIMARY KEY (session_id, sequence)
);
INSERT INTO runtime_checkpoints (session_id, sequence, format, item)
  VALUES ('gen-fixture', 0, 'openai-responses-input/1', '{"type":"message","role":"user","content":"synthetic"}');

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
