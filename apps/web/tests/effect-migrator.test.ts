import assert from "node:assert/strict";
import { FileSystem } from "@effect/platform/FileSystem";
import { Path } from "@effect/platform/Path";
import { NodeContext } from "@effect/platform-node";
import * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  bootstrapFromDrizzleHistory,
  DRIZZLE_MIGRATIONS_TABLE,
  type JournalEntry,
  MIGRATIONS_TABLE,
  runWebMigrations,
  webMigrationJournal,
  webMigrations,
} from "../server/db/effect-migrator.js";
import { testSqlClient, unmigratedPgliteSqlClient } from "./support/sql-client.js";

interface RecordedMigration {
  readonly id: number;
  readonly name: string;
}

function withPlatform<A, E>(layer: Layer.Layer<A, E>): Layer.Layer<A | NodeContext.NodeContext, E> {
  return Layer.provideMerge(layer, NodeContext.layer);
}

const recorded = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    readonly migration_id: number;
    readonly name: string;
  }>`select migration_id, name from ${sql(MIGRATIONS_TABLE)} order by migration_id`
    .withoutTransform;
  return rows.map((row): RecordedMigration => ({ id: row.migration_id, name: row.name }));
});

const named = (
  migrations: ReadonlyArray<readonly [id: number, name: string]>,
): ReadonlyArray<RecordedMigration> => migrations.map(([id, name]) => ({ id, name }));

const resolved = Effect.map(webMigrations(), (migrations) =>
  named(migrations.map(([id, name]) => [id, name])),
);

/**
 * Two scales meet in these tests, and a comparison across them is off by one
 * in exactly the direction that hides a skipped migration. A journal entry's
 * `idx` is the file's own number (`0021_…` is idx 21); the migrator records
 * that entry as id 22, because it reads a database with no history as standing
 * at id zero. Every comparison below is in the migrator's scale, and this is
 * the one place a journal entry is converted into it.
 */
function migratorIdOf(entry: Pick<JournalEntry, "idx">): number {
  return entry.idx + 1;
}

type DeclaredMigration = Pick<JournalEntry, "idx" | "tag">;

/** The journal, as the records a run over it should leave behind: in the migrator's scale. */
function declaredBy(entries: ReadonlyArray<DeclaredMigration>): ReadonlyArray<RecordedMigration> {
  return entries.map((entry) => ({ id: migratorIdOf(entry), name: entry.tag }));
}

const idsOf = (migrations: ReadonlyArray<RecordedMigration>): ReadonlySet<number> =>
  new Set(migrations.map((migration) => migration.id));

const greatest = (ids: ReadonlySet<number>): number => Math.max(...ids);

/** The declared ids the database has no record of: the migrations a run skipped. */
function unapplied(
  declared: ReadonlySet<number>,
  applied: ReadonlySet<number>,
): ReadonlyArray<number> {
  return [...declared].filter((id) => !applied.has(id));
}

function seedDrizzleHistory(createdAt: number) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const schema = sql(DRIZZLE_MIGRATIONS_TABLE.SCHEMA);
    const table = sql(DRIZZLE_MIGRATIONS_TABLE.NAME);
    yield* sql`create schema ${schema}`;
    yield* sql`
      create table ${schema}.${table} (
        id serial primary key,
        hash text not null,
        created_at bigint
      )
    `;
    yield* sql`
      insert into ${schema}.${table} (hash, created_at)
      values (${"seeded"}, ${createdAt})
    `;
  });
}

it.layer(withPlatform(testSqlClient))(
  "the web migration runner over a database already at the latest migration",
  (it) => {
    it.effect("applies nothing, and records every migration the folder holds", () =>
      Effect.gen(function* () {
        assert.deepEqual(named(yield* runWebMigrations()), []);
        assert.deepEqual(yield* recorded, yield* resolved);
      }),
    );

    it.effect("applies nothing a second time either", () =>
      Effect.gen(function* () {
        yield* runWebMigrations();
        assert.deepEqual(named(yield* runWebMigrations()), []);
        assert.deepEqual(yield* recorded, yield* resolved);
      }),
    );

    it.effect("has recorded the journal's ids, every one of them and no other", () =>
      Effect.gen(function* () {
        const declared = declaredBy(yield* webMigrationJournal());
        const applied = yield* recorded;
        assert.deepEqual(idsOf(applied), idsOf(declared));
        assert.equal(greatest(idsOf(applied)), greatest(idsOf(declared)));
        assert.deepEqual(unapplied(idsOf(declared), idsOf(applied)), []);
        assert.deepEqual(applied, declared);
      }),
    );
  },
);

it.effect("the loader numbers each entry as the journal's index plus one", () =>
  Effect.gen(function* () {
    assert.deepEqual(yield* resolved, declaredBy(yield* webMigrationJournal()));
  }).pipe(Effect.provide(NodeContext.layer)),
);

/** A database of its own per test: `it.layer` would share one across the group. */
function onFreshDatabase<A, E>(
  effect: Effect.Effect<A, E, SqlClient.SqlClient | NodeContext.NodeContext>,
): Effect.Effect<A, E | SqlError> {
  return Effect.provide(effect, withPlatform(unmigratedPgliteSqlClient));
}

it.effect("a fresh database takes every migration the folder holds, in the journal's order", () =>
  onFreshDatabase(
    Effect.gen(function* () {
      assert.deepEqual(named(yield* runWebMigrations()), yield* resolved);
      assert.deepEqual(yield* recorded, yield* resolved);
    }),
  ),
);

it.effect("the bootstrap records only the migrations Drizzle's history says were applied", () =>
  onFreshDatabase(
    Effect.gen(function* () {
      const boundary = 3;
      const entry = (yield* webMigrationJournal())[boundary];
      assert.ok(entry);
      const applied = (yield* resolved).slice(0, boundary + 1);
      yield* seedDrizzleHistory(entry.when);
      assert.deepEqual(named(yield* bootstrapFromDrizzleHistory()), applied);
      assert.deepEqual(yield* recorded, applied);
    }),
  ),
);

it.effect("the bootstrap records nothing when there is no Drizzle history to read", () =>
  onFreshDatabase(
    Effect.gen(function* () {
      assert.deepEqual(named(yield* bootstrapFromDrizzleHistory()), []);
      assert.deepEqual(yield* recorded, []);
    }),
  ),
);

type SyntheticEntry = DeclaredMigration;

const SYNTHETIC_JOURNAL_VERSION = "7";
const SYNTHETIC_JOURNAL_EPOCH = 1_700_000_000_000;

const SYNTHETIC_ENTRIES: ReadonlyArray<SyntheticEntry> = [
  { idx: 0, tag: "0000_first" },
  { idx: 1, tag: "0001_second" },
  { idx: 2, tag: "0002_third" },
  { idx: 3, tag: "0003_fourth" },
];

const SYNTHETIC_META_DIRECTORY = "meta";
const SYNTHETIC_JOURNAL_FILE = "_journal.json";

function journalDocument(entries: ReadonlyArray<SyntheticEntry>): string {
  return JSON.stringify({
    version: SYNTHETIC_JOURNAL_VERSION,
    dialect: "postgresql",
    entries: entries.map((entry) => ({
      idx: entry.idx,
      version: SYNTHETIC_JOURNAL_VERSION,
      when: SYNTHETIC_JOURNAL_EPOCH + entry.idx,
      tag: entry.tag,
      breakpoints: true,
    })),
  });
}

/**
 * A generated folder of the test's own, in the shape the loader reads: one
 * `create table` per entry and a journal the test rewrites between runs, which
 * is how a database comes to stand ahead of an entry the journal then names.
 */
function syntheticMigrationsFolder(entries: ReadonlyArray<SyntheticEntry>) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem;
    const path = yield* Path;
    const folder = yield* fileSystem.makeTempDirectoryScoped();
    yield* fileSystem.makeDirectory(path.join(folder, SYNTHETIC_META_DIRECTORY));
    yield* Effect.forEach(entries, (entry) =>
      fileSystem.writeFileString(
        path.join(folder, `${entry.tag}.sql`),
        `create table "${entry.tag}" (id integer primary key)`,
      ),
    );
    const journal = (named: ReadonlyArray<SyntheticEntry>) =>
      fileSystem.writeFileString(
        path.join(folder, SYNTHETIC_META_DIRECTORY, SYNTHETIC_JOURNAL_FILE),
        journalDocument(named),
      );
    return { folder, journal };
  });
}

it.effect(
  "an entry below the applied maximum is skipped without a failure, and the ids check names it",
  () =>
    onFreshDatabase(
      Effect.scoped(
        Effect.gen(function* () {
          const skipped = SYNTHETIC_ENTRIES[2];
          assert.ok(skipped);
          const before = SYNTHETIC_ENTRIES.filter((entry) => entry !== skipped);
          const { folder, journal } = yield* syntheticMigrationsFolder(SYNTHETIC_ENTRIES);

          yield* journal(before);
          assert.deepEqual(named(yield* runWebMigrations(folder)), declaredBy(before));

          yield* journal(SYNTHETIC_ENTRIES);
          assert.deepEqual(named(yield* runWebMigrations(folder)), []);

          const declared = declaredBy(yield* webMigrationJournal(folder));
          const applied = yield* recorded;
          assert.notDeepEqual(idsOf(applied), idsOf(declared));
          assert.deepEqual(unapplied(idsOf(declared), idsOf(applied)), [migratorIdOf(skipped)]);
          // The maximum alone is blind to a gap below it; the set is what sees it.
          assert.equal(greatest(idsOf(applied)), greatest(idsOf(declared)));
        }),
      ),
    ),
);

it.effect(
  "an entry at the applied maximum under another name is skipped too, and the records check names it",
  () =>
    onFreshDatabase(
      Effect.scoped(
        Effect.gen(function* () {
          const last = SYNTHETIC_ENTRIES[SYNTHETIC_ENTRIES.length - 1];
          assert.ok(last);
          const renamed: SyntheticEntry = { idx: last.idx, tag: "0003_renamed" };
          const after = [...SYNTHETIC_ENTRIES.filter((entry) => entry !== last), renamed];
          const { folder, journal } = yield* syntheticMigrationsFolder([
            ...SYNTHETIC_ENTRIES,
            renamed,
          ]);

          yield* journal(SYNTHETIC_ENTRIES);
          yield* runWebMigrations(folder);

          yield* journal(after);
          assert.deepEqual(named(yield* runWebMigrations(folder)), []);

          const declared = declaredBy(yield* webMigrationJournal(folder));
          const applied = yield* recorded;
          assert.deepEqual(idsOf(applied), idsOf(declared));
          assert.notDeepEqual(applied, declared);
        }),
      ),
    ),
);
