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

type SyncTriggers = Map<string, Map<string, string>>;

interface SyncObjects {
  readonly triggers: SyncTriggers;
  readonly functions: Map<string, string>;
}

export interface SyncDrift {
  readonly table: string;
  readonly object: string;
  readonly installed: string | undefined;
  readonly rendered: string | undefined;
}

export interface FiredTopics<A> {
  readonly value: A;
  readonly txids: readonly string[];
}

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

export const syncDrift = (
  tables: readonly SyncTable[],
): Effect.Effect<readonly SyncDrift[], SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const installed = yield* readSyncObjects;
    const rendered = yield* renderedSyncObjects(tables);
    return [...declaredDrift(tables, installed, rendered), ...undeclaredDrift(tables, installed)];
  });

function topicSet(topics: readonly SyncTopic[]): readonly SyncTopic[] {
  const byKind = new Map<TopicKind, Set<string>>();
  for (const [kind, id] of topics) byKind.set(kind, (byKind.get(kind) ?? new Set()).add(id));
  return [...byKind]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([kind, ids]) => [...ids].sort().map((id): SyncTopic => [kind, id]));
}

function heardUntil(payloads: Stream.Stream<string, SqlError>, fence: string) {
  return payloads.pipe(
    Stream.mapEffect((payload) => decodeNotification(payload)),
    Stream.takeUntil(
      (notification: SyncNotification) => "h" in notification && notification.h === fence,
    ),
    Stream.runCollect,
  );
}

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
