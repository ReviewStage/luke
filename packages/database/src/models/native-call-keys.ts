import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { DateTime, Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { nativeCallKey } from "../schemas/native-call-key.js";

const upsertKey = SqlSchema.findOne({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    digest: Schema.String,
    fresh: Schema.String,
    now: Schema.Date,
    mintedAfter: Schema.Date,
  }),
  Result: Schema.Struct({ key: Schema.String }),
  execute: ({ userId, conversationId, digest, fresh, now, mintedAfter }) => {
    const expired = sql`${nativeCallKey.mintedAt} <= ${mintedAfter.toISOString()}::timestamptz`;
    return Database.use((db) =>
      db
        .insert(nativeCallKey)
        .values({ userId, conversationId, digest, key: fresh, mintedAt: now })
        .onConflictDoUpdate({
          target: [nativeCallKey.userId, nativeCallKey.conversationId, nativeCallKey.digest],
          set: {
            key: sql`case when ${expired} then excluded.key else ${nativeCallKey.key} end`,
            mintedAt: sql`case when ${expired} then excluded.minted_at else ${nativeCallKey.mintedAt} end`,
          },
        })
        .returning({ key: nativeCallKey.key }),
    );
  },
});

export function nativeCallKeyOf(
  userId: string,
  conversationId: string,
  digest: string,
  windowMs: number,
): Effect.Effect<string, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const mintedAfter = new Date(now.getTime() - windowMs);
    const row = yield* upsertKey({
      userId,
      conversationId,
      digest,
      fresh: randomUUID(),
      now,
      mintedAfter,
    });
    return row.key;
  }).pipe(Effect.catchTag("NoSuchElementError", (error) => Effect.die(error)));
}
