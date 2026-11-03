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

/**
 * The sync log's settled id against writes committing out of the order they
 * logged in, on a real Postgres with two connections beside the test's own,
 * which PGlite's one connection cannot hold apart. A logs a row and stays
 * open while B logs after it and commits: the reader is not handed past A's
 * id until A commits, and the delta from where it was held then carries A's
 * row. A takes its id before B
 * does, so the reader's snapshot lists it as running, or after, so it stands
 * at the snapshot's `xmax`, past the newest transaction to end, where a
 * horizon read from a snapshot once passed it over. This file runs in CI's
 * Postgres job, where `APP_STORE_TEST_DATABASE_URL` names the database
 * (`vitest.config.ts`).
 */

const PROBE = pgTable("sync_log_probe", {
  id: uuid("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
});

const probeSync = defineSyncTable(PROBE, {
  topics: [{ kind: TOPIC.WORKSPACE, column: PROBE.workspaceId }],
  log: LOG.EVERY,
});

/** The test database with the probe created and its capture installed, as a migration would. */
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

/** Runs an effect on a connection of its own to the test's database, as `dispatch-claim.postgres.test.ts` does. */
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

/** The id of the transaction under way, taking one where it has none yet. */
const takeTxid = Effect.flatMap(SqlClient.SqlClient, (client) =>
  Effect.map(client<{ readonly txid: string }>`select pg_current_xact_id()::text as txid`, (rows) =>
    Number(rows[0]?.txid ?? assert.fail("no transaction id")),
  ),
);

/** A probe row written in the transaction under way, answering the transaction's id. */
const logProbe = Effect.gen(function* () {
  const db = yield* Database;
  yield* db.insert(PROBE).values({ id: randomUUID(), workspaceId: randomUUID() });
  return yield* takeTxid;
});

/** The ids of the transactions logged in [from, below), one per row, as a delta reads them. */
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

/**
 * How many times the reader looks for the settled id to pass a committed
 * transaction: a transaction another file holds open on the same cluster
 * holds it back too, until that transaction ends.
 */
const LOOKS = 10_000;

/** The standing once its settled id is past the transaction's, or as it stands after the last look. */
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
