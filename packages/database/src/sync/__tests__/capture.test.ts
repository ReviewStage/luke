import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq, sql } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { Database } from "../../core/query.js";
import { timestamptz } from "../../schemas/_helpers.js";
import { expectTopicsFire, getTestDB, installSyncTables, syncDrift } from "../../testing/index.js";
import { TOPIC } from "../notification.js";
import { defineSyncTable } from "../sync-table.js";
import { SYNC_TABLES } from "../tables.js";

/**
 * Luke Sync's capture, on a table only these tests create: a row names its
 * workspace and task itself, and takes its agents from the parents of its
 * group, which it names by a key many parents share. What a write notifies
 * is heard on the test database's own listener, so on PGlite and on the CI
 * Postgres alike.
 */

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

/** The same table once a column is added to it. */
const PROBE_WITH_NOTE = pgTable("sync_probe", { ...probeColumns, note: text("note") });

const PROBE_SQL = [
  "create table sync_probe_parent (id uuid primary key, group_id uuid not null, agent_id text)",
  "create table sync_probe (id uuid primary key, workspace_id text not null, task_id text, group_id uuid, title text not null, touched_at timestamptz)",
];

const probeSync = defineSyncTable(PROBE, {
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
});

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

/** The test database with the probe's tables created and their capture installed, as a migration would. */
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

/** A group of parents, one agent each, answering the group's id and the agents' ids. */
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
      // Each agent's topic is about 50 bytes, so 400 take more than two payloads.
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

it.layer(probeDB)("the drift check on a synced table", (it) => {
  it.effect("a column added fails it until the table's triggers are regenerated", () =>
    Effect.gen(function* () {
      const client = yield* SqlClient.SqlClient;
      yield* client.unsafe("alter table sync_probe add column note text");

      const before = yield* syncDrift([probeWithNoteSync]);
      yield* installSyncTables([probeWithNoteSync]);
      const after = yield* syncDrift([probeWithNoteSync]);

      assert.deepEqual(
        before.map((object) => object.object),
        ["luke_sync_update"],
      );
      assert.deepEqual(after, []);
    }),
  );

  it.effect("a sync trigger no declaration renders fails it", () =>
    Effect.gen(function* () {
      const drift = yield* syncDrift([]);

      assert.deepEqual(
        drift.map((object) => [object.table, object.object, object.rendered]).sort(),
        [
          ["sync_probe", "luke_sync_update", undefined],
          ["sync_probe", "luke_sync_write", undefined],
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
        "regenerate the drifted tables' capture: pnpm --filter @luke/database sync:render <migration> <table>…",
      );
    }),
  );
});
