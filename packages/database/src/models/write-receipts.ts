/**
 * write-receipts.ts -- the keys an account's writes were taken under: whether one stands, and one kept as its write commits.
 *
 * A receipt is the account's own: one is read by the account and the key
 * together, so a key another account sent is never found. Each one kept
 * prunes the account's receipts older than the window it is kept with, so
 * nothing else sweeps them.
 */

import { and, eq, lt } from "drizzle-orm";
import { DateTime, Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { writeReceipt } from "../schemas/write-receipt.js";

const findReceipt = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, key: Schema.String }),
  Result: Schema.Struct({ key: Schema.String }),
  execute: ({ userId, key }) =>
    Database.use((db) =>
      db
        .select({ key: writeReceipt.key })
        .from(writeReceipt)
        .where(and(eq(writeReceipt.userId, userId), eq(writeReceipt.key, key)))
        .limit(1),
    ),
});

/** Whether the account's write under `key` was taken already. */
export function writeReceiptStands(
  userId: string,
  key: string,
): Effect.Effect<boolean, StoreFailure, DatabaseServices> {
  return Effect.map(findReceipt({ userId, key }), (rows) => rows.length > 0);
}

/**
 * The account's write under `key` kept as taken now, a key kept already
 * left as it was, and the account's receipts taken more than `keptMs` ago
 * let go.
 */
export function keepWriteReceipt(
  userId: string,
  key: string,
  keptMs: number,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const before = new Date(now.getTime() - keptMs);
    yield* Database.use((db) =>
      db
        .insert(writeReceipt)
        .values({ userId, key, writtenAt: now })
        .onConflictDoNothing({ target: [writeReceipt.userId, writeReceipt.key] }),
    );
    yield* Database.use((db) =>
      db
        .delete(writeReceipt)
        .where(and(eq(writeReceipt.userId, userId), lt(writeReceipt.writtenAt, before))),
    );
  });
}
