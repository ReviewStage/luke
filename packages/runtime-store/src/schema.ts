/**
 * The per-agent database, one file under the agent's own directory in Luke's
 * application data. Every kind of thing the brain kept in one JSON envelope
 * has a table of its own here, so a request, an act's receipt, a transcript
 * cursor, and the model's opaque checkpoint items can be written and let go
 * of separately, and the history the panel draws is kept apart from the
 * payloads it is projected from.
 *
 * Two lifetimes are deliberately kept apart. A conversation session — the
 * brain's generation — dies at a fixed age or at a Clear, and its checkpoints,
 * cursors, requests, and receipts cascade away with it. The history the panel
 * draws answers to its own rolling retention instead: a history event names
 * the session that stood when it was written, for attribution, but the column
 * is not a foreign key, so a generation's expiry erases no visible line. Only
 * the Clear erases both, and it does so explicitly. A conversation's history
 * sequence counts up from a counter on the conversation row and is never
 * reused, however many lines retention or a Clear has let go of. The Clear's
 * cutoff is kept on the conversation row as well, written in the same
 * transaction as the generation's marker and only ever raised, so a line from
 * before a Clear stays refused after the generation that carried the marker
 * has itself expired.
 *
 * The schema is versioned by the `schema_version` table. A database at a
 * version this build does not know is refused rather than migrated by guess.
 */

export const RUNTIME_SCHEMA_VERSION = 1;

/** The format tag every checkpoint item carries, naming whose shape it is. */
export const CHECKPOINT_FORMAT = {
  /** An item of the OpenAI Responses input array, stored as its JSON. */
  OPENAI_RESPONSES_INPUT_V1: "openai-responses-input/1",
} as const;

export type CheckpointFormat = (typeof CHECKPOINT_FORMAT)[keyof typeof CHECKPOINT_FORMAT];

export const RUNTIME_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    session_key TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(agent_id),
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    next_history_sequence INTEGER NOT NULL DEFAULT 1,
    history_cleared_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS conversation_sessions (
    session_id TEXT PRIMARY KEY,
    session_key TEXT NOT NULL REFERENCES conversations(session_key),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    reset_cleared_at INTEGER,
    reset_generation_id TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS conversation_sessions_one_standing
    ON conversation_sessions(session_key)`,
  `CREATE TABLE IF NOT EXISTS runtime_checkpoints (
    session_id TEXT NOT NULL REFERENCES conversation_sessions(session_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    format TEXT NOT NULL,
    item TEXT NOT NULL,
    PRIMARY KEY (session_id, sequence)
  )`,
  `CREATE TABLE IF NOT EXISTS observation_cursors (
    session_id TEXT NOT NULL REFERENCES conversation_sessions(session_id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL,
    provider_session_id TEXT NOT NULL,
    cursor TEXT NOT NULL,
    PRIMARY KEY (session_id, provider_id, provider_session_id)
  )`,
  `CREATE TABLE IF NOT EXISTS requests (
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
  )`,
  `CREATE INDEX IF NOT EXISTS requests_by_session ON requests(session_id, ordinal)`,
  `CREATE TABLE IF NOT EXISTS action_receipts (
    run_id TEXT NOT NULL,
    call_id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES conversation_sessions(session_id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    name TEXT NOT NULL,
    arguments_json TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    output_json TEXT,
    settled_at INTEGER,
    PRIMARY KEY (run_id, call_id)
  )`,
  `CREATE INDEX IF NOT EXISTS action_receipts_by_session ON action_receipts(session_id, ordinal)`,
  `CREATE TABLE IF NOT EXISTS history_events (
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
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS history_events_by_key
    ON history_events(session_key, event_key)`,
  `CREATE INDEX IF NOT EXISTS history_events_by_time
    ON history_events(session_key, recorded_at, sequence)`,
  `CREATE TABLE IF NOT EXISTS publications (
    session_key TEXT NOT NULL REFERENCES conversations(session_key),
    request_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    event_sequence INTEGER NOT NULL,
    recorded_at INTEGER NOT NULL,
    PRIMARY KEY (session_key, request_id, kind)
  )`,
  `CREATE TABLE IF NOT EXISTS migration_receipts (
    source TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    imported_at INTEGER NOT NULL,
    outcome TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS personal_facts (
    id TEXT PRIMARY KEY,
    ordinal INTEGER NOT NULL,
    words TEXT NOT NULL UNIQUE
  )`,
];
