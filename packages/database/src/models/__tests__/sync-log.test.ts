import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { asc, sql } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { syncLog } from "../../schemas/sync-log.js";
import { getTestDB } from "../../testing/index.js";
import { pruneSyncLog, syncStanding } from "../sync-log.js";

const NOW = new Date(Date.UTC(2026, 10, 3, 12));
const OLD = new Date(NOW.getTime() - 4 * 24 * 60 * 60 * 1_000);
const YOUNG = new Date(NOW.getTime() - 60 * 60 * 1_000);

const logRow = (at: Date) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [row] = yield* db
      .insert(syncLog)
      .values({
        txid: sql`pg_current_xact_id()::text::bigint`,
        at,
        tableName: "probe",
        key: [],
        topics: [],
      })
      .returning({ txid: syncLog.txid });
    return row?.txid ?? assert.fail("the row was not logged");
  });

const loggedTxids = Effect.flatMap(Database, (db) =>
  Effect.map(db.select({ txid: syncLog.txid }).from(syncLog).orderBy(asc(syncLog.txid)), (rows) =>
    rows.map((row) => row.txid),
  ),
);

it.layer(getTestDB())("the sync log's pruning", (it) => {
  it.effect("cuts below the first young row, keeping the newest row and every row above", () =>
    Effect.gen(function* () {
      yield* logRow(OLD);
      const quietNewest = yield* logRow(OLD);
      const quietPruned = yield* pruneSyncLog(NOW);
      const quiet = yield* syncStanding();
      const young = yield* logRow(YOUNG);
      const longTransaction = yield* logRow(OLD);
      const newest = yield* logRow(YOUNG);

      const busyPruned = yield* pruneSyncLog(NOW);
      const busy = yield* syncStanding();

      assert.equal(quietPruned, 1);
      assert.equal(quiet.floor, quietNewest);
      assert.equal(busyPruned, 1);
      assert.deepEqual(yield* loggedTxids, [young, longTransaction, newest]);
      assert.equal(busy.floor, young);
      assert.ok(busy.settled > newest, "every logged transaction has ended");
    }),
  );
});
