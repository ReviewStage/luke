/**
 * sync.ts -- Luke Sync's capture as a test reads it: the drift check, and what a write notifies.
 *
 * The drift check holds the migrated database to the declarations: every
 * function and trigger a declaration renders stands as it renders it, and
 * no sync trigger stands that none renders. It compares what Postgres
 * itself writes back for each object (`pg_get_triggerdef`,
 * `pg_get_functiondef`), so two spellings of one trigger are one: the
 * declarations' capture is installed inside a transaction that is rolled
 * back, read, and set beside what the database held before.
 *
 * `expectTopicsFire` runs a write while listening and holds the topics its
 * notifications carried to the ones a test names. Postgres delivers a
 * listener the notifications of different transactions in the order they
 * committed, so a heartbeat sent after the write is a fence: once it
 * arrives, everything the write's transactions notified has too, and a
 * write that notifies nothing is shown to by the fence alone.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Data, Effect, Fiber, Schema, Stream } from "effect";
import { SqlClient } from "effect/sql";
import type { SqlError } from "effect/sql/SqlError";
import { SyncListener } from "../sync/listener.js";
import {
  SYNC_CHANNEL,
  type SyncNotification,
  SyncNotificationSchema,
  type SyncTopic,
  type TopicKind,
} from "../sync/notification.js";
import { renderSyncTable, SYNC_TRIGGER, syncFunctionName } from "../sync/render.js";
import { SYNC_OBJECT_PREFIX, type SyncTable } from "../sync/sync-table.js";

/** Each sync trigger's definition, by its table, then its name. */
type SyncTriggers = Map<string, Map<string, string>>;

/** The sync functions and triggers a database holds, as Postgres writes each back. */
interface SyncObjects {
  readonly triggers: SyncTriggers;
  readonly functions: Map<string, string>;
}

/** One function or trigger that is not as the declarations render it. */
export interface SyncDrift {
  readonly table: string;
  /** The function's or the trigger's name. */
  readonly object: string;
  /** As the database holds it, or undefined where it holds none. */
  readonly installed: string | undefined;
  /** As the declarations render it, or undefined where none renders it. */
  readonly rendered: string | undefined;
}

/** What the notifications a write sent carried. */
export interface FiredTopics<A> {
  readonly value: A;
  /** The ids of the transactions that notified, each once. */
  readonly txids: readonly string[];
}

/** Carries the capture read inside its transaction out of it, failing being what rolls the transaction back. */
class RenderedSyncObjects extends Data.TaggedError("RenderedSyncObjects")<{
  readonly objects: SyncObjects;
}> {}

const decodeNotification = Schema.decodeEffect(SyncNotificationSchema);
const encodeNotification = Schema.encodeEffect(SyncNotificationSchema);

const readSyncObjects = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const triggerRows = yield* sql<{ table: string; name: string; definition: string }>`
    select c.relname as "table", t.tgname as "name", pg_get_triggerdef(t.oid) as "definition"
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal and starts_with(t.tgname, ${SYNC_OBJECT_PREFIX})
  `;
  const functionRows = yield* sql<{ name: string; definition: string }>`
    select p.proname as "name", pg_get_functiondef(p.oid) as "definition"
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and starts_with(p.proname, ${SYNC_OBJECT_PREFIX})
  `;
  const triggers: SyncTriggers = new Map();
  for (const row of triggerRows) {
    const ofTable = triggers.get(row.table) ?? new Map<string, string>();
    triggers.set(row.table, ofTable.set(row.name, row.definition));
  }
  const functions = new Map(functionRows.map((row) => [row.name, row.definition]));
  return { triggers, functions } satisfies SyncObjects;
});

/** Installs each table's capture as its migration would: its drops, then its creates. */
export const installSyncTables = (
  tables: readonly SyncTable[],
): Effect.Effect<void, SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    for (const table of tables) {
      const capture = renderSyncTable(table);
      for (const statement of [...capture.drop, ...capture.create]) yield* sql.unsafe(statement);
    }
  });

/** The capture the declarations render, as Postgres writes it back, with the database left as it stood. */
const renderedSyncObjects = (tables: readonly SyncTable[]) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* installSyncTables(tables);
          return yield* new RenderedSyncObjects({ objects: yield* readSyncObjects });
        }),
      )
      .pipe(Effect.catchTag("RenderedSyncObjects", ({ objects }) => Effect.succeed(objects))),
  );

/** Each declared table's function and triggers, as one database holds them and as the other does. */
function declaredDrift(
  tables: readonly SyncTable[],
  installed: SyncObjects,
  rendered: SyncObjects,
): readonly SyncDrift[] {
  return tables.flatMap((table) => {
    const name = syncFunctionName(table);
    const objects = [
      {
        object: name,
        installed: installed.functions.get(name),
        rendered: rendered.functions.get(name),
      },
      ...Object.values(SYNC_TRIGGER).map((trigger) => ({
        object: trigger,
        installed: installed.triggers.get(table.name)?.get(trigger),
        rendered: rendered.triggers.get(table.name)?.get(trigger),
      })),
    ];
    return objects.flatMap((object) =>
      object.installed === object.rendered ? [] : [{ table: table.name, ...object }],
    );
  });
}

/** Every sync trigger the database holds that no declaration renders. */
function undeclaredDrift(
  tables: readonly SyncTable[],
  installed: SyncObjects,
): readonly SyncDrift[] {
  const declared = new Set(tables.map((table) => table.name));
  const rendered = new Set<string>(Object.values(SYNC_TRIGGER));
  return [...installed.triggers].flatMap(([table, triggers]) =>
    [...triggers].flatMap(([object, definition]) =>
      declared.has(table) && rendered.has(object)
        ? []
        : [{ table, object, installed: definition, rendered: undefined }],
    ),
  );
}

/** The drift check: every way the database's capture differs from the declarations', none where it matches. */
export const syncDrift = (
  tables: readonly SyncTable[],
): Effect.Effect<readonly SyncDrift[], SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const installed = yield* readSyncObjects;
    const rendered = yield* renderedSyncObjects(tables);
    return [...declaredDrift(tables, installed, rendered), ...undeclaredDrift(tables, installed)];
  });

/** The topics, each once, sorted by kind and then id, so two lists of one set compare equal. */
function topicSet(topics: readonly SyncTopic[]): readonly SyncTopic[] {
  const byKind = new Map<TopicKind, Set<string>>();
  for (const [kind, id] of topics) byKind.set(kind, (byKind.get(kind) ?? new Set()).add(id));
  return [...byKind]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([kind, ids]) => [...ids].sort().map((id): SyncTopic => [kind, id]));
}

/** Everything heard up to the fence's heartbeat. */
function heardUntil(payloads: Stream.Stream<string, SqlError>, fence: string) {
  return payloads.pipe(
    Stream.mapEffect((payload) => decodeNotification(payload)),
    Stream.takeUntil(
      (notification: SyncNotification) => "h" in notification && notification.h === fence,
    ),
    Stream.runCollect,
  );
}

/**
 * Runs the write while listening, and fails unless the notifications it
 * sent carried exactly the topics named, each counted once: none, for a
 * write that must notify nothing. Answers the write's value and the ids
 * of the transactions that notified.
 */
export const expectTopicsFire = <A, E, R>(
  write: Effect.Effect<A, E, R>,
  topics: readonly SyncTopic[],
): Effect.Effect<
  FiredTopics<A>,
  E | SqlError | Schema.SchemaError,
  R | SyncListener | SqlClient.SqlClient
> =>
  Effect.scoped(
    Effect.gen(function* () {
      const listener = yield* SyncListener;
      const sql = yield* SqlClient.SqlClient;
      const fence = randomUUID();
      const heard = yield* Effect.forkScoped(heardUntil((yield* listener.listen).payloads, fence));
      const value = yield* write;
      yield* sql`select pg_notify(${SYNC_CHANNEL}, ${yield* encodeNotification({ h: fence })})`;
      const changes = (yield* Fiber.join(heard)).flatMap((notification) =>
        "t" in notification ? [notification] : [],
      );
      assert.deepEqual(
        topicSet(changes.flatMap((change) => change.t)),
        topicSet(topics),
        "the topics the write notified",
      );
      return { value, txids: [...new Set(changes.map((change) => change.x))] };
    }),
  );
