/**
 * The per-agent database, one file under the agent's own directory in Luke's
 * application data. Every kind of thing the brain kept in one JSON envelope
 * has a table of its own here, so a request, an action's receipt, a transcript
 * cursor, and the model's opaque checkpoint items can be written and let go
 * of separately, and the conversation the panel draws is kept apart from the
 * payloads it is projected from.
 *
 * Two lifetimes are deliberately kept apart. A conversation session — the
 * brain's generation — dies at a fixed age or at a Clear, and its checkpoints,
 * cursors, requests, and receipts cascade away with it. The conversation the panel
 * draws answers to its own rolling retention instead: a conversation event names
 * the session that stood when it was written, for attribution, but the column
 * is not a foreign key, so a generation's expiry erases no visible line. Only
 * the Clear erases both, and it does so explicitly. A conversation's line
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
 * The durable observation inbox holds the observations captured for a
 * conversation and not yet consumed by a turn, and the capture cursors that
 * say how far each transcript has been written down — kept apart from the
 * consumed cursors, which say how far a model has read.
 *
 * Delegation is one row per child run and one per completion, each its
 * record as the child service wrote it. A completion is written before its
 * delivery is tried and stands apart from the child's row, so a child's
 * result survives a delivery that could not land, and a launch finds both
 * what was still running and what was still owed.
 *
 * The notebook's Markdown files are the source of truth for what Luke
 * remembers, so only derived and provenance rows stand here: the search
 * index over the notebook (sources, chunks, their FTS5 shadow, the embedding
 * cache), and the notebook entries' provenance (each USER.md line's id and
 * origin, and the file hash last reconciled). The `personal_facts` table is
 * kept only for the migration the worker runs at open, which moves each fact
 * into USER.md under the same id and empties the table; nothing writes it
 * any more.
 *
 * Memory maintenance keeps each conversation's last flush, so a flush runs
 * once per compaction cycle.
 *
 * The tables a nightly consolidation sweep once kept — its short-term
 * candidates, ingestion cursors and seen-message hashes, source tombstones,
 * and MEMORY.md rewrite preimages — are gone: nothing reads or writes them
 * any more, and the notebook's files are the source of truth they were
 * derived from.
 *
 * The conversation's own tables are named for what they hold:
 * `conversation_events` for its lines and `conversation_archives` for the
 * recovery payloads of deleted conversations, with the conversation row's
 * sequence, cutoff, and the request's recorded-at column named to match.
 * Version 11 carries nothing across that rename: a database from before it
 * is refused at the door rather than opened onto tables whose columns it
 * lacks, and no step exists to carry it over.
 *
 * The conversation's own tables are named for what they hold:
 * `conversation_events` for its lines and `conversation_archives` for the
 * recovery payloads of deleted conversations, with the conversation row's
 * sequence, cutoff, and the request's recorded-at column named to match.
 * Version 11 carries nothing across that rename: a database from before it
 * is refused at the door rather than opened onto tables whose columns it
 * lacks, and no step exists to carry it over.
 *
 * The schema is versioned by the `schema_version` table. A database at a
 * version this build does not know is refused rather than migrated by guess.
 */

import type { SQLInputValue } from "node:sqlite";

/**
 * One flush marker per conversation: the generation and compaction count the
 * last completed flush ran under. A row is consulted only for the generation
 * it names, so a marker from an earlier lifetime never reads as this cycle's.
 */
const MEMORY_FLUSH_STATE_TABLE = `CREATE TABLE IF NOT EXISTS memory_flush_state (
    session_key TEXT PRIMARY KEY,
    generation_id TEXT NOT NULL,
    compaction_count INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    flushed_at INTEGER NOT NULL
  )`;

export const STORE_SCHEMA_VERSION = 11;

/**
 * The earliest version this build opens. The rename at 11 carried nothing
 * across: a database from before it still holds the old table and column
 * names, and `CREATE TABLE IF NOT EXISTS` cannot rename a column on a table
 * that already stands, so opening one would fail at its first write. It is
 * refused at the door instead, and there is no step that carries it over.
 */
export const STORE_SCHEMA_FLOOR = 11;

/**
 * How a database at an earlier version is brought to this one, in order. Each
 * step runs inside the migration's transaction. A version the map does not
 * name altered no table that already stood — it only added ones the current
 * statements create where none is — so it migrates by having nothing to do;
 * a database at a version this build does not know at all is refused rather
 * than migrated by guess, which `StoreDatabase.open` raises before any step.
 */
export interface SchemaMigrationStep {
  sql: string;
  params: readonly SQLInputValue[];
}

export const STORE_SCHEMA_MIGRATIONS: ReadonlyMap<number, readonly SchemaMigrationStep[]> =
  new Map();

export const STORE_SCHEMA_STATEMENTS: readonly string[] = [
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
    next_conversation_sequence INTEGER NOT NULL DEFAULT 1,
    conversation_cleared_at INTEGER,
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
    checkpoint_format TEXT,
    compaction_count INTEGER NOT NULL DEFAULT 0
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
  `CREATE TABLE IF NOT EXISTS observation_capture_cursors (
    session_id TEXT NOT NULL REFERENCES conversation_sessions(session_id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL,
    provider_session_id TEXT NOT NULL,
    cursor TEXT NOT NULL,
    PRIMARY KEY (session_id, provider_id, provider_session_id)
  )`,
  `CREATE TABLE IF NOT EXISTS observation_inbox (
    session_id TEXT NOT NULL REFERENCES conversation_sessions(session_id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    entry_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (session_id, ordinal)
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
    performed_actions INTEGER NOT NULL,
    unknown_actions INTEGER NOT NULL,
    ask_recorded_at INTEGER,
    conversation_recorded_at INTEGER
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
  `CREATE TABLE IF NOT EXISTS conversation_events (
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
  `CREATE UNIQUE INDEX IF NOT EXISTS conversation_events_by_key
    ON conversation_events(session_key, event_key)`,
  `CREATE INDEX IF NOT EXISTS conversation_events_by_time
    ON conversation_events(session_key, recorded_at, sequence)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS conversation_events_once_published
    ON conversation_events(session_key, request_id, kind) WHERE request_id IS NOT NULL`,
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
  `CREATE TABLE IF NOT EXISTS conversation_archives (
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
  )`,
  `CREATE TABLE IF NOT EXISTS child_runs (
    child_id TEXT PRIMARY KEY,
    requester_session_key TEXT NOT NULL,
    child_session_key TEXT NOT NULL,
    status TEXT NOT NULL,
    accepted_at INTEGER NOT NULL,
    settled_at INTEGER,
    archived_at INTEGER,
    payload TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS child_runs_by_requester ON child_runs(requester_session_key, accepted_at)`,
  `CREATE TABLE IF NOT EXISTS child_completions (
    completion_id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL,
    destination_session_key TEXT NOT NULL,
    delivery_status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    next_attempt_at INTEGER,
    payload TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS personal_facts (
    id TEXT PRIMARY KEY,
    ordinal INTEGER NOT NULL,
    words TEXT NOT NULL UNIQUE
  )`,
  `CREATE TABLE IF NOT EXISTS notebook_entries (
    id TEXT PRIMARY KEY,
    words TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    origin TEXT NOT NULL,
    migrated_fact_id TEXT,
    UNIQUE (path, words)
  )`,
  `CREATE TABLE IF NOT EXISTS notebook_files (
    path TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    reconciled_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memory_index_sources (
    path TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    hash TEXT NOT NULL,
    mtime REAL NOT NULL,
    size INTEGER NOT NULL,
    origin TEXT NOT NULL,
    indexed_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memory_index_chunks (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    source TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    hash TEXT NOT NULL,
    model TEXT NOT NULL,
    text TEXT NOT NULL,
    embedding TEXT NOT NULL,
    entry_ids TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS memory_index_chunks_by_path ON memory_index_chunks(path)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS memory_index_chunks_fts
    USING fts5(text, id UNINDEXED, path UNINDEXED, tokenize = 'unicode61')`,
  `CREATE TABLE IF NOT EXISTS memory_embedding_cache (
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    hash TEXT NOT NULL,
    embedding TEXT NOT NULL,
    dims INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (provider, model, hash)
  )`,
  MEMORY_FLUSH_STATE_TABLE,
];
