import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { and, asc, gte, lt } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { Database, type DatabaseServices } from "../../core/query.js";
import { sqlClientOverUrl } from "../../core/sql-client.js";
import { syncLog } from "../../schemas/sync-log.js";
import { TOPIC } from "../../sync/notification.js";
import { defineSyncTable, LOG } from "../../sync/sync-table.js";
import {
  getTestDB,
  installSyncTables,
  STORE_TEST_DATABASE_ENVIRONMENT,
} from "../../testing/index.js";
import { syncStanding } from "../sync-log.js";

const PROBE = pgTable("sync_log_probe", {
  id: uuid("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
});

const probeSync = defineSyncTable(PROBE, {
  topics: [{ kind: TOPIC.WORKSPACE, column: PROBE.workspaceId }],
  log: LOG.EVERY,
});

const probeDB = Layer.provideMerge(
  Layer.effectDiscard(
    Effect.gen(function* () {
      const client = yield* SqlClient.SqlClient;
      yield* client.unsafe(
        "create table sync_log_probe (id uuid primary key, workspace_id text not null)",
      );
      yield* installSyncTables([probeSync]);
    }),
  ),
  getTestDB(),
);

const anotherConnection = Effect.gen(function* () {
  const client = yield* SqlClient.SqlClient;
  const [row] = yield* client<{ readonly name: string }>`select current_database() as name`;
  const url = new URL(process.env[STORE_TEST_DATABASE_ENVIRONMENT.URL] ?? "");
  url.pathname = `/${row?.name ?? ""}`;
  const layer = Layer.fresh(sqlClientOverUrl(url.toString()));
  return <A, E>(effect: Effect.Effect<A, E, DatabaseServices>) => Effect.provide(effect, layer);
});

const transacted = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(effect));

const takeTxid = Effect.flatMap(SqlClient.SqlClient, (client) =>
  Effect.map(client<{ readonly txid: string }>`select pg_current_xact_id()::text as txid`, (rows) =>
    Number(rows[0]?.txid ?? assert.fail("no transaction id")),
  ),
);

const logProbe = Effect.gen(function* () {
  const db = yield* Database;
  yield* db.insert(PROBE).values({ id: randomUUID(), workspaceId: randomUUID() });
  return yield* takeTxid;
});

const txidsBetween = (from: number, below: number) =>
  Effect.flatMap(Database, (db) =>
    Effect.map(
      db
        .select({ txid: syncLog.txid })
        .from(syncLog)
        .where(and(gte(syncLog.txid, from), lt(syncLog.txid, below)))
        .orderBy(asc(syncLog.txid)),
      (rows) => rows.map((row) => row.txid),
    ),
  );

const LOOKS = 10_000;

const settledPast = (txid: number) =>
  Effect.gen(function* () {
    let standing = yield* syncStanding();
    for (let look = 1; look < LOOKS && standing.settled <= txid; look += 1) {
      yield* Effect.yieldNow;
      standing = yield* syncStanding();
    }
    return standing;
  });

it.layer(probeDB)("the sync log's settled id", (it) => {
  it.effect.each([
    { order: "A takes its id first", bFirst: false },
    { order: "B takes its id first", bFirst: true },
  ])(
    "stays at or below a write still to commit under a newer one committed, where $order",
    ({ bFirst }) =>
      Effect.gen(function* () {
        const onA = yield* anotherConnection;
        const onB = yield* anotherConnection;
        const bHasTxid = yield* Deferred.make<void>();
        const bMayLog = yield* Deferred.make<void>();
        const aLogged = yield* Deferred.make<number>();
        const aMayCommit = yield* Deferred.make<void>();

        const b = yield* Effect.forkChild(
          onB(
            transacted(
              Effect.gen(function* () {
                if (bFirst) yield* takeTxid;
                yield* Deferred.succeed(bHasTxid, undefined);
                yield* Deferred.await(bMayLog);
                return yield* logProbe;
              }),
            ),
          ),
        );
        yield* Deferred.await(bHasTxid);
        const a = yield* Effect.forkChild(
          onA(
            transacted(
              Effect.gen(function* () {
                yield* Deferred.succeed(aLogged, yield* logProbe);
                yield* Deferred.await(aMayCommit);
              }),
            ),
          ),
        );
        const aTxid = yield* Deferred.await(aLogged);
        yield* Deferred.succeed(bMayLog, undefined);
        const bTxid = yield* Fiber.join(b);
        const held = yield* syncStanding();
        yield* Deferred.succeed(aMayCommit, undefined);
        yield* Fiber.join(a);
        const passed = yield* settledPast(Math.max(aTxid, bTxid));

        assert.ok(held.settled <= aTxid, "the settled id passed a write still to commit");
        assert.ok(
          passed.settled > Math.max(aTxid, bTxid),
          "the settled id passed both once committed",
        );
        assert.ok(
          (yield* txidsBetween(held.settled, passed.settled)).includes(aTxid),
          "the next delta carries the write that committed late",
        );
      }),
  );
});
