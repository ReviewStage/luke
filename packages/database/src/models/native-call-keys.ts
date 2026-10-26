/**
 * native-call-keys.ts -- the key a native agent's call of a Luke tool runs under: one per conversation, tool, and input, held for a window.
 *
 * The key is read and written in one statement, so two calls of one input
 * at once, as a harness's retry after a timeout and the call it timed out
 * on can be, are given one key: the row is written where none stands, read
 * back where its key was minted within the window, and replaced where it
 * was minted before it, so a call of the same input long after is a call of
 * its own again.
 */

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
    // The standing key is kept while it was minted within the window; the fresh one replaces it, with its minting, once a whole window has passed.
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

/**
 * The key the account's call on the conversation runs under: the one a call
 * of the same digest was given within the last `windowMs`, else a fresh one
 * minted now, which the calls of that digest within the window from now
 * read back.
 */
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
  }).pipe(
    // Note that an upsert always answers the one row it wrote, so no row is a defect rather than a failure a caller reads.
    Effect.catchTag("NoSuchElementError", (error) => Effect.die(error)),
  );
}
