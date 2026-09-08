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
 * has itself expired. A run's ask and its end are each published once
 * however many windows report them, and the schema itself carries that rule:
 * a partial unique index over the run and kind of every line tied to a run,
 * per conversation, so a second publication has no row it could occupy.
 *
 * The stored record and the model's projection are two different tables. The
 * transcript table keeps every input the context engine ingested and every
 * point at which the projection folded, per conversation and never cascading
 * with a lifetime, so a compaction or a Start fresh changes the projection
 * and erases no record; the checkpoint rows are the projection, stamped once
 * on the generation rather than per row. The conversation row carries its
 * kind and where it stands in its lifecycle — archived, pinned, last active —
 * which is what maintenance reads, and the archive registry holds each
 * deleted conversation's compressed recovery payload, committed in the
 * transaction that removed the rows and cleared only once the file it names
 * is published and verified.
 *
 * The schema is versioned by the `schema_version` table. A database at a
 * version this build does not know is refused rather than migrated by guess.
 */

import type { SQLInputValue } from "node:sqlite";
import { LEGACY_CHECKPOINT_FORMAT_TAG } from "@sidecar/brain";

export const RUNTIME_SCHEMA_VERSION = 3;

/**
 * How a database at an earlier version is brought to this one, in order. Each
 * step runs inside the migration's transaction; a version this build does not
 * know how to reach is refused rather than guessed at.
 */
export interface SchemaMigrationStep {
  sql: string;
  params: readonly SQLInputValue[];
}

export const RUNTIME_SCHEMA_MIGRATIONS: ReadonlyMap<number, readonly SchemaMigrationStep[]> =
  new Map([
    [
      2,
      [
        { sql: "ALTER TABLE conversation_sessions ADD COLUMN checkpoint_format TEXT", params: [] },
        {
          sql: `UPDATE conversation_sessions SET checkpoint_format = ?
       WHERE checkpoint_format IS NULL
         AND EXISTS (SELECT 1 FROM runtime_checkpoints WHERE runtime_checkpoints.session_id = conversation_sessions.session_id)`,
          params: [LEGACY_CHECKPOINT_FORMAT_TAG],
        },
      ],
    ],
    [
      3,
      [
        { sql: "ALTER TABLE runtime_checkpoints DROP COLUMN format", params: [] },
        {
          sql: "ALTER TABLE conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'main'",
          params: [],
        },
        { sql: "ALTER TABLE conversations ADD COLUMN archived_at INTEGER", params: [] },
        { sql: "ALTER TABLE conversations ADD COLUMN archive_reason TEXT", params: [] },
        { sql: "ALTER TABLE conversations ADD COLUMN pinned_at INTEGER", params: [] },
        {
          sql: "ALTER TABLE conversations ADD COLUMN last_activity_at INTEGER NOT NULL DEFAULT 0",
          params: [],
        },
        {
          sql: "ALTER TABLE conversations ADD COLUMN next_transcript_sequence INTEGER NOT NULL DEFAULT 1",
          params: [],
        },
        {
          sql: `UPDATE conversations SET last_activity_at = MAX(
         created_at,
         COALESCE((SELECT MAX(recorded_at) FROM history_events WHERE history_events.session_key = conversations.session_key), 0),
         COALESCE((SELECT MAX(created_at) FROM conversation_sessions WHERE conversation_sessions.session_key = conversations.session_key), 0)
       )`,
          params: [],
        },
      ],
    ],
  ]);

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
    history_cleared_at INTEGER,
    kind TEXT NOT NULL DEFAULT 'main',
    archived_at INTEGER,
    archive_reason TEXT,
    pinned_at INTEGER,
    last_activity_at INTEGER NOT NULL DEFAULT 0,
    next_transcript_sequence INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS conversation_sessions (
    session_id TEXT PRIMARY KEY,
    session_key TEXT NOT NULL REFERENCES conversations(session_key),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    reset_cleared_at INTEGER,
    reset_generation_id TEXT,
    checkpoint_format TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS conversation_sessions_one_standing
    ON conversation_sessions(session_key)`,
  `CREATE TABLE IF NOT EXISTS runtime_checkpoints (
    session_id TEXT NOT NULL REFERENCES conversation_sessions(session_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
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
  `CREATE UNIQUE INDEX IF NOT EXISTS history_events_once_published
    ON history_events(session_key, request_id, kind) WHERE request_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS transcript_events (
    session_key TEXT NOT NULL REFERENCES conversations(session_key),
    sequence INTEGER NOT NULL,
    session_id TEXT,
    kind TEXT NOT NULL,
    recorded_at INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (session_key, sequence)
  )`,
  `CREATE TABLE IF NOT EXISTS compaction_boundaries (
    session_key TEXT NOT NULL REFERENCES conversations(session_key),
    transcript_sequence INTEGER NOT NULL,
    session_id TEXT,
    source TEXT NOT NULL,
    dropped INTEGER NOT NULL,
    checkpoint_format TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (session_key, transcript_sequence)
  )`,
  `CREATE TABLE IF NOT EXISTS history_archives (
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
    history_lines INTEGER NOT NULL,
    transcript_events INTEGER NOT NULL,
    previous_cutoff INTEGER,
    payload BLOB
  )`,
  `CREATE TABLE IF NOT EXISTS personal_facts (
    id TEXT PRIMARY KEY,
    ordinal INTEGER NOT NULL,
    words TEXT NOT NULL UNIQUE
  )`,
];
