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

export function writeReceiptStands(
  userId: string,
  key: string,
): Effect.Effect<boolean, StoreFailure, DatabaseServices> {
  return Effect.map(findReceipt({ userId, key }), (rows) => rows.length > 0);
}

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
