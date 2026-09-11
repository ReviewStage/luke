import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { NodeFileSystem } from "@effect/platform-node";
import * as Client from "@effect/sql/SqlClient";
import { describe, it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import { MAIN_SESSION_KEY } from "@sidecar/runtime/vocabulary";
import { Effect, Either } from "effect";
import { migrateStoreSchema, StoreSchemaRefused } from "./migration.js";
import { STORE_SCHEMA_VERSION } from "./schema.js";
import { layer } from "./sql-node-sqlite.js";

const FIXTURE_DIRECTORY = path.join(
  fileURLToPath(import.meta.url),
  "../../../fixtures/store-schema",
);

/** The instants every fixture is seeded with, so what a step computes is a value to assert. */
const CREATED_AT = 1_800_000_000_000;
const LAST_LINE_AT = CREATED_AT + 2000;
const LEGACY_CHECKPOINT_FORMAT = "tool-loop@1:openai-responses-input/1";
const CHECKPOINT_ITEM = '{"type":"message","role":"user","content":"synthetic"}';

/**
 * A fixture database per version this build carries forward from. Versions 4
 * through 8 name no step of their own and the map records no table they
 * changed, so each is the version-3 shape under its own version marker: what
 * a build between them wrote can differ only in tables the current statements
 * create where none stands, which is the case every fixture here already
 * exercises.
 */
const UPGRADES = [
  { version: 1, fixture: "v01.sql", requests: 0, archives: 0, compactionCount: 0 },
  { version: 2, fixture: "v02.sql", requests: 0, archives: 0, compactionCount: 0 },
  { version: 3, fixture: "v03.sql", requests: 1, archives: 0, compactionCount: 0 },
  { version: 4, fixture: "v03.sql", requests: 1, archives: 0, compactionCount: 0 },
  { version: 5, fixture: "v03.sql", requests: 1, archives: 0, compactionCount: 0 },
  { version: 6, fixture: "v03.sql", requests: 1, archives: 0, compactionCount: 0 },
  { version: 7, fixture: "v03.sql", requests: 1, archives: 0, compactionCount: 0 },
  { version: 8, fixture: "v03.sql", requests: 1, archives: 0, compactionCount: 0 },
  { version: 9, fixture: "v09.sql", requests: 1, archives: 1, compactionCount: 3 },
  { version: 10, fixture: "v10.sql", requests: 1, archives: 1, compactionCount: 3 },
  { version: 11, fixture: "v11.sql", requests: 1, archives: 1, compactionCount: 3 },
] as const;

const EXPECTED_TABLES = [
  "action_receipts",
  "agents",
  "child_completions",
  "child_runs",
  "compaction_boundaries",
  "conversation_archives",
  "conversation_events",
  "conversation_sessions",
  "conversations",
  "memory_embedding_cache",
  "memory_flush_state",
  "memory_index_chunks",
  "memory_index_chunks_fts",
  "memory_index_sources",
  "notebook_entries",
  "notebook_files",
  "observation_capture_cursors",
  "observation_cursors",
  "observation_inbox",
  "personal_facts",
  "requests",
  "runtime_checkpoints",
  "schema_version",
  "transcript_events",
] as const;

const EXPECTED_COLUMNS = {
  conversations: [
    "session_key",
    "agent_id",
    "name",
    "created_at",
    "next_conversation_sequence",
    "conversation_cleared_at",
    "kind",
    "archived_at",
    "archive_reason",
    "pinned_at",
    "last_activity_at",
    "next_transcript_sequence",
  ],
  conversation_sessions: [
    "session_id",
    "session_key",
    "created_at",
    "expires_at",
    "reset_cleared_at",
    "reset_generation_id",
    "checkpoint_format",
    "compaction_count",
  ],
  runtime_checkpoints: ["session_id", "sequence", "item"],
  requests: [
    "run_id",
    "session_id",
    "ordinal",
    "submission_id",
    "origin",
    "question",
    "status",
    "revision",
    "accepted_at",
    "started_at",
    "settled_at",
    "text",
    "failure",
    "performed_actions",
    "unknown_actions",
    "ask_recorded_at",
    "conversation_recorded_at",
    "usage_json",
    "response_ids_json",
  ],
  conversation_archives: [
    "archive_id",
    "session_key",
    "kind",
    "name",
    "created_at",
    "deleted_at",
    "encoding",
    "sha256",
    "byte_length",
    "file_name",
    "published_at",
    "conversation_lines",
    "transcript_events",
    "previous_cutoff",
    "payload",
  ],
} as const;

const withNodeFileSystem = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer));

/** The migration, and everything it needs, over the database at `filename`. */
const overStore = <A, E>(filename: string, effect: Effect.Effect<A, E, Client.SqlClient>) =>
  Effect.provide(effect, layer({ filename }));

/**
 * Writes the fixture out as a database at `version`. The marker is stamped
 * after the fixture's own statements so one shape can stand for a run of
 * versions that changed nothing between them.
 */
const seed = (directory: string, fixture: string, version: number) => {
  const filename = path.join(directory, `agent-${version}.sqlite`);
  const db = new DatabaseSync(filename);
  db.exec(fs.readFileSync(path.join(FIXTURE_DIRECTORY, fixture), "utf8"));
  db.prepare("UPDATE schema_version SET version = ?").run(version);
  db.close();
  return filename;
};

const names = (rows: ReadonlyArray<{ readonly name: string }>) => rows.map((row) => row.name);

/** The version the file stands at and every table on it, before or after a run. */
const standing = Effect.gen(function* () {
  const sql = yield* Client.SqlClient;
  return {
    versions: (yield* sql<{
      readonly version: number;
    }>`SELECT version FROM schema_version`).map((row) => row.version),
    tables: names(
      yield* sql<{
        readonly name: string;
      }>`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    ),
  };
});

/** Everything the assertions read, as values, over a client of its own. */
const inspect = Effect.gen(function* () {
  const sql = yield* Client.SqlClient;
  const versions = yield* sql<{ readonly version: number }>`SELECT version FROM schema_version`;
  const tables = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      AND name NOT LIKE 'memory_index_chunks_fts_%'
    ORDER BY name`;
  const columnsOf = (table: string) =>
    Effect.map(sql<{ readonly name: string }>`SELECT name FROM pragma_table_info(${table})`, names);
  return {
    versions: versions.map((row) => row.version),
    tables: names(tables),
    columns: {
      conversations: yield* columnsOf("conversations"),
      conversation_sessions: yield* columnsOf("conversation_sessions"),
      runtime_checkpoints: yield* columnsOf("runtime_checkpoints"),
      requests: yield* columnsOf("requests"),
      conversation_archives: yield* columnsOf("conversation_archives"),
    },
    conversation: (yield* sql<{
      readonly next_conversation_sequence: number;
      readonly conversation_cleared_at: number | null;
      readonly kind: string;
      readonly last_activity_at: number;
    }>`SELECT next_conversation_sequence, conversation_cleared_at, kind, last_activity_at
       FROM conversations WHERE session_key = ${MAIN_SESSION_KEY}`).map((row) => ({
      nextSequence: row.next_conversation_sequence,
      clearedAt: row.conversation_cleared_at,
      kind: row.kind,
      lastActivityAt: row.last_activity_at,
    })),
    generation: (yield* sql<{
      readonly checkpoint_format: string | null;
      readonly compaction_count: number;
    }>`SELECT checkpoint_format, compaction_count FROM conversation_sessions`).map((row) => ({
      checkpointFormat: row.checkpoint_format,
      compactionCount: row.compaction_count,
    })),
    items: (yield* sql<{
      readonly item: string;
    }>`SELECT item FROM runtime_checkpoints ORDER BY sequence`).map((row) => row.item),
    lines: (yield* sql<{
      readonly words: string;
    }>`SELECT words FROM conversation_events ORDER BY sequence`).map((row) => row.words),
    requests: (yield* sql<{
      readonly run_id: string;
      readonly usage_json: string | null;
    }>`SELECT run_id, usage_json FROM requests ORDER BY run_id`).map((row) => ({
      runId: row.run_id,
      usage: row.usage_json,
    })),
    archives: (yield* sql<{
      readonly conversation_lines: number;
    }>`SELECT conversation_lines FROM conversation_archives`).map((row) => row.conversation_lines),
    flushes: (yield* sql<{
      readonly compaction_count: number;
    }>`SELECT compaction_count FROM memory_flush_state`).map((row) => row.compaction_count),
  };
});

describe("the store's schema migration", () => {
  for (const upgrade of UPGRADES) {
    it.effect(`walks a database at version ${upgrade.version} forward to this build's`, () =>
      withNodeFileSystem(
        Effect.gen(function* () {
          const directory = yield* temporaryDirectoryScoped();
          const filename = seed(directory, upgrade.fixture, upgrade.version);

          yield* overStore(filename, migrateStoreSchema);
          const store = yield* overStore(filename, inspect);

          assert.deepEqual(store.versions, [STORE_SCHEMA_VERSION]);
          assert.deepEqual(store.tables, [...EXPECTED_TABLES]);
          assert.deepEqual(store.columns.conversations, [...EXPECTED_COLUMNS.conversations]);
          assert.deepEqual(store.columns.conversation_sessions, [
            ...EXPECTED_COLUMNS.conversation_sessions,
          ]);
          assert.deepEqual(store.columns.runtime_checkpoints, [
            ...EXPECTED_COLUMNS.runtime_checkpoints,
          ]);
          assert.deepEqual(store.columns.requests, [...EXPECTED_COLUMNS.requests]);
          assert.deepEqual(store.columns.conversation_archives, [
            ...EXPECTED_COLUMNS.conversation_archives,
          ]);
          // The rows the fixture carried stand where the renames left them.
          assert.deepEqual(store.conversation, [
            {
              nextSequence: 2,
              clearedAt: CREATED_AT - 1,
              kind: "main",
              lastActivityAt: LAST_LINE_AT,
            },
          ]);
          assert.deepEqual(store.generation, [
            {
              checkpointFormat: LEGACY_CHECKPOINT_FORMAT,
              compactionCount: upgrade.compactionCount,
            },
          ]);
          assert.deepEqual(store.items, [CHECKPOINT_ITEM]);
          assert.deepEqual(store.lines, ["synthetic line"]);
          // The two columns version 12 adds reach a record from before them
          // as absent rather than as a value it never carried.
          assert.deepEqual(
            store.requests,
            upgrade.requests === 0 ? [] : [{ runId: "run-1", usage: null }],
          );
          assert.deepEqual(store.archives, upgrade.archives === 0 ? [] : [1]);
          // Version 9 starts the flush markers over, so a database from
          // before it carries none and one from 9 onward keeps its own.
          assert.deepEqual(store.flushes, upgrade.version >= 9 ? [2] : []);
        }),
      ),
    );
  }

  it.effect("creates the schema and stamps this build's version on a database with none", () =>
    withNodeFileSystem(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectoryScoped();
        const filename = path.join(directory, "agent.sqlite");

        yield* overStore(filename, migrateStoreSchema);
        const store = yield* overStore(filename, inspect);

        assert.deepEqual(store.versions, [STORE_SCHEMA_VERSION]);
        assert.deepEqual(store.tables, [...EXPECTED_TABLES]);
        assert.deepEqual(store.lines, []);
      }),
    ),
  );

  it.effect("runs again over the database it just migrated and changes nothing", () =>
    withNodeFileSystem(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectoryScoped();
        const filename = seed(directory, "v01.sql", 1);

        yield* overStore(filename, migrateStoreSchema);
        const once = yield* overStore(filename, inspect);
        yield* overStore(filename, migrateStoreSchema);
        yield* overStore(filename, migrateStoreSchema);
        const thrice = yield* overStore(filename, inspect);

        assert.deepEqual(thrice, once);
        assert.deepEqual(thrice.versions, [STORE_SCHEMA_VERSION]);
      }),
    ),
  );

  it.effect("leaves the version and every table as they were when a step fails part way", () =>
    withNodeFileSystem(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectoryScoped();
        const filename = seed(directory, "v01.sql", 1);
        // Version 3 drops the checkpoint item's format column, which SQLite
        // refuses on a table that has none: a database walked this far and no
        // further is what the one transaction has to undo.
        const db = new DatabaseSync(filename);
        db.exec("ALTER TABLE runtime_checkpoints DROP COLUMN format");
        db.close();
        const before = yield* overStore(filename, standing);

        const outcome = yield* Effect.either(overStore(filename, migrateStoreSchema));

        assert.equal(Either.isLeft(outcome), true);
        if (Either.isLeft(outcome)) assert.equal(outcome.left._tag, "SqlError");
        assert.deepEqual(yield* overStore(filename, standing), before);
        assert.deepEqual(before.versions, [1]);
      }),
    ),
  );

  it.effect("refuses a database at a version this build cannot reach from", () =>
    withNodeFileSystem(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectoryScoped();
        for (const version of [STORE_SCHEMA_VERSION + 1, 0]) {
          const filename = seed(directory, "v11.sql", version);

          const outcome = yield* Effect.either(overStore(filename, migrateStoreSchema));

          assert.equal(Either.isLeft(outcome) && outcome.left instanceof StoreSchemaRefused, true);
          if (Either.isLeft(outcome) && outcome.left instanceof StoreSchemaRefused) {
            assert.equal(outcome.left.version, version);
          }
          assert.deepEqual((yield* overStore(filename, standing)).versions, [version]);
        }
      }),
    ),
  );
});
