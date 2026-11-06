import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { asc, count, eq, sql } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { Database } from "../../core/query.js";
import { timestamptz } from "../../schemas/_helpers.js";
import { syncLog } from "../../schemas/sync-log.js";
import { expectTopicsFire, getTestDB, installSyncTables, syncDrift } from "../../testing/index.js";
import { TOPIC } from "../notification.js";
import { defineSyncTable, LOG, type SyncLogWrites } from "../sync-table.js";
import { SYNC_TABLES } from "../tables.js";

const PROBE_PARENT = pgTable("sync_probe_parent", {
  id: uuid("id").primaryKey(),
  groupId: uuid("group_id").notNull(),
  agentId: text("agent_id"),
});

const probeColumns = {
  id: uuid("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  taskId: text("task_id"),
  groupId: uuid("group_id"),
  title: text("title").notNull(),
  touchedAt: timestamptz("touched_at"),
};

const PROBE = pgTable("sync_probe", probeColumns);

const PROBE_WITH_NOTE = pgTable("sync_probe", { ...probeColumns, note: text("note") });

const PROBE_SQL = [
  "create table sync_probe_parent (id uuid primary key, group_id uuid not null, agent_id text)",
  "create table sync_probe (id uuid primary key, workspace_id text not null, task_id text, group_id uuid, title text not null, touched_at timestamptz)",
];

const probeSyncLogging = (log?: SyncLogWrites) =>
  defineSyncTable(PROBE, {
    topics: [
      { kind: TOPIC.WORKSPACE, column: PROBE.workspaceId },
      { kind: TOPIC.TASK, column: PROBE.taskId },
      {
        through: PROBE_PARENT,
        key: PROBE_PARENT.groupId,
        by: PROBE.groupId,
        topics: [{ kind: TOPIC.AGENT, column: PROBE_PARENT.agentId }],
      },
    ],
    ignore: [PROBE.touchedAt],
    ...(log === undefined ? {} : { log }),
  });

const probeSync = probeSyncLogging();

const probeWithNoteSync = defineSyncTable(PROBE_WITH_NOTE, {
  topics: [
    { kind: TOPIC.WORKSPACE, column: PROBE_WITH_NOTE.workspaceId },
    { kind: TOPIC.TASK, column: PROBE_WITH_NOTE.taskId },
    {
      through: PROBE_PARENT,
      key: PROBE_PARENT.groupId,
      by: PROBE_WITH_NOTE.groupId,
      topics: [{ kind: TOPIC.AGENT, column: PROBE_PARENT.agentId }],
    },
  ],
  ignore: [PROBE_WITH_NOTE.touchedAt],
});

const probeDB = Layer.provideMerge(
  Layer.effectDiscard(
    Effect.gen(function* () {
      const client = yield* SqlClient.SqlClient;
      for (const statement of PROBE_SQL) yield* client.unsafe(statement);
      yield* installSyncTables([probeSync]);
    }),
  ),
  getTestDB(),
);

const insertGroup = (agents: number) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const groupId = randomUUID();
    const agentIds = Array.from({ length: agents }, () => randomUUID());
    yield* db
      .insert(PROBE_PARENT)
      .values(agentIds.map((agentId) => ({ id: randomUUID(), groupId, agentId })));
    return { groupId, agentIds };
  });

const insertProbe = (row: typeof PROBE.$inferInsert) =>
  Effect.flatMap(Database, (db) =>
    db.insert(PROBE).values(row).returning({ txid: sql<string>`pg_current_xact_id()::text` }),
  );

const updateProbe = (id: string, set: Partial<typeof PROBE.$inferInsert>) =>
  Effect.flatMap(Database, (db) => db.update(PROBE).set(set).where(eq(PROBE.id, id)));

const deleteProbe = (id: string) =>
  Effect.flatMap(Database, (db) => db.delete(PROBE).where(eq(PROBE.id, id)));

const loggedBy = <E, R>(writes: Effect.Effect<unknown, E, R>) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [before] = yield* db.select({ rows: count() }).from(syncLog);
    yield* writes;
    const rows = yield* db
      .select({ table: syncLog.tableName, key: syncLog.key, topics: syncLog.topics })
      .from(syncLog)
      .orderBy(asc(syncLog.txid), asc(sql`${syncLog.key}::text collate "C"`));
    return rows.slice(before?.rows ?? 0).map((row) => ({
      table: row.table,
      ids: (row.key as readonly { readonly id: string }[]).map((key) => key.id).sort(),
      topics: row.topics,
    }));
  });

it.layer(probeDB)("what a write to a synced table notifies", (it) => {
  it.effect("an insert notifies its own topics and its parent's, with its transaction's id", () =>
    Effect.gen(function* () {
      const { groupId, agentIds } = yield* insertGroup(1);
      const row = { id: randomUUID(), workspaceId: randomUUID(), taskId: randomUUID(), groupId };

      const fired = yield* expectTopicsFire(insertProbe({ ...row, title: "Insert" }), [
        [TOPIC.WORKSPACE, row.workspaceId],
        [TOPIC.TASK, row.taskId],
        ...agentIds.map((agentId) => [TOPIC.AGENT, agentId] as const),
      ]);

      assert.deepEqual(
        fired.txids,
        fired.value.map((written) => written.txid),
      );
    }),
  );

  it.effect("a delete notifies the topics of the row it removed, skipping a null one", () =>
    Effect.gen(function* () {
      const row = { id: randomUUID(), workspaceId: randomUUID(), taskId: null, title: "Delete" };
      yield* insertProbe(row);

      yield* expectTopicsFire(
        Effect.flatMap(Database, (db) => db.delete(PROBE).where(eq(PROBE.id, row.id))),
        [[TOPIC.WORKSPACE, row.workspaceId]],
      );
    }),
  );

  it.effect("an update of only an ignored column notifies nothing", () =>
    Effect.gen(function* () {
      const row = { id: randomUUID(), workspaceId: randomUUID(), taskId: randomUUID() };
      yield* insertProbe({ ...row, title: "Touched" });

      yield* expectTopicsFire(updateProbe(row.id, { touchedAt: new Date() }), []);
    }),
  );

  it.effect("moving a row between tasks notifies both", () =>
    Effect.gen(function* () {
      const row = { id: randomUUID(), workspaceId: randomUUID(), taskId: randomUUID() };
      yield* insertProbe({ ...row, title: "Moved" });
      const to = randomUUID();

      yield* expectTopicsFire(updateProbe(row.id, { taskId: to }), [
        [TOPIC.WORKSPACE, row.workspaceId],
        [TOPIC.TASK, row.taskId],
        [TOPIC.TASK, to],
      ]);
    }),
  );

  it.effect("a lookup matching many parents notifies them all, past one payload's limit", () =>
    Effect.gen(function* () {
      const { groupId, agentIds } = yield* insertGroup(400);
      const row = { id: randomUUID(), workspaceId: randomUUID(), groupId, title: "Many" };

      yield* expectTopicsFire(insertProbe(row), [
        [TOPIC.WORKSPACE, row.workspaceId],
        ...agentIds.map((agentId) => [TOPIC.AGENT, agentId] as const),
      ]);
    }),
  );

  it.effect("a write rolled back notifies nothing", () =>
    Effect.gen(function* () {
      const client = yield* SqlClient.SqlClient;
      const row = { id: randomUUID(), workspaceId: randomUUID(), title: "Rolled back" };
      const rolledBack = client.withTransaction(
        Effect.andThen(insertProbe(row), Effect.fail("rolled back")),
      );

      const fired = yield* expectTopicsFire(Effect.flip(rolledBack), []);

      assert.equal(fired.value, "rolled back");
    }),
  );
});

it.layer(probeDB)("what a write to a logged table logs", (it) => {
  it.effect(
    "one row per row written, naming its keys, the old and the new where it moved, and its topics",
    () =>
      Effect.gen(function* () {
        yield* installSyncTables([probeSyncLogging(LOG.EVERY)]);
        const workspaceId = randomUUID();
        const taskId = randomUUID();
        const [first, second, moved] = [randomUUID(), randomUUID(), randomUUID()];
        const topics = [
          [TOPIC.TASK, taskId],
          [TOPIC.WORKSPACE, workspaceId],
        ];

        const logged = yield* loggedBy(
          Effect.gen(function* () {
            yield* Effect.flatMap(Database, (db) =>
              db
                .insert(PROBE)
                .values(
                  [first, second].map((id) => ({ id, workspaceId, taskId, title: "Logged" })),
                ),
            );
            yield* updateProbe(first, { title: "Retitled" });
            yield* updateProbe(second, { id: moved });
            yield* deleteProbe(first);
          }),
        );

        const inserted = [first, second].sort();
        assert.deepEqual(logged, [
          { table: "sync_probe", ids: [inserted[0]], topics },
          { table: "sync_probe", ids: [inserted[1]], topics },
          { table: "sync_probe", ids: [first], topics },
          { table: "sync_probe", ids: [moved, second].sort(), topics },
          { table: "sync_probe", ids: [first], topics },
        ]);
      }),
  );

  it.effect("a table logging its rows logs their arrival and removal, never an update", () =>
    Effect.gen(function* () {
      yield* installSyncTables([probeSyncLogging(LOG.ROWS)]);
      const row = { id: randomUUID(), workspaceId: randomUUID(), title: "Rows" };

      const logged = yield* loggedBy(
        Effect.gen(function* () {
          yield* insertProbe(row);
          yield* updateProbe(row.id, { title: "Retitled" });
          yield* deleteProbe(row.id);
        }),
      );

      assert.deepEqual(
        logged.map((entry) => entry.ids),
        [[row.id], [row.id]],
      );
    }),
  );
});

it.layer(probeDB)("the drift check on a synced table", (it) => {
  it.effect("a column added fails it until the table's triggers are regenerated", () =>
    Effect.gen(function* () {
      const client = yield* SqlClient.SqlClient;
      yield* client.unsafe("alter table sync_probe add column note text");

      const before = yield* syncDrift([...SYNC_TABLES, probeWithNoteSync]);
      yield* installSyncTables([probeWithNoteSync]);
      const after = yield* syncDrift([...SYNC_TABLES, probeWithNoteSync]);

      assert.deepEqual(
        before.map((object) => object.object),
        ["app_sync_update"],
      );
      assert.deepEqual(after, []);
    }),
  );

  it.effect("a sync trigger no declaration renders fails it", () =>
    Effect.gen(function* () {
      const drift = yield* syncDrift(SYNC_TABLES);

      assert.deepEqual(
        drift.map((object) => [object.table, object.object, object.rendered]).sort(),
        [
          ["sync_probe", "app_sync_update", undefined],
          ["sync_probe", "app_sync_write", undefined],
        ],
      );
    }),
  );
});

it.layer(getTestDB())("the drift check on the migrated database", (it) => {
  it.effect("passes: it carries exactly the capture the declarations render", () =>
    Effect.gen(function* () {
      assert.deepEqual(
        yield* syncDrift(SYNC_TABLES),
        [],
        "regenerate the drifted tables' capture: pnpm --filter @repo/database sync:render <migration> <table>…",
      );
    }),
  );
});
