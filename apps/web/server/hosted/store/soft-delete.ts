import { lte } from "drizzle-orm";
import { Duration, Effect, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { db } from "../../db/query.js";
import { conversations } from "../../db/storage-schema.js";

/**
 * The purge that follows a soft delete. Nothing is erased at the stamp: a
 * deleted plan's conversation is stamped `deleted_at` (`plan-store.ts`), so
 * the reads — which skip a stamped row — show nothing of it from the call
 * after, while the rows stand until the purge. There is no archive, no
 * registry, and no cutoff: the stamp is the whole record, and the cron's
 * purge removes the stamped conversations thirty days on, their messages,
 * turns, and events going with them by the schema's own cascade. Deleting
 * the account cascades everything at once, stamped or not.
 */

/** How long a cleared conversation's rows stand before the purge takes them. */
export const CLEARED_CONVERSATION_RETENTION_MS = Duration.toMillis(Duration.days(30));

type ClearFailure = SqlError | Schema.SchemaError;

const IdRowSchema = Schema.Struct({ id: Schema.String });

const purgeRows = SqlSchema.findAll({
  Request: Schema.Date,
  Result: IdRowSchema,
  execute: (edge) =>
    db
      .delete(conversations)
      .where(lte(conversations.deletedAt, edge))
      .returning({ id: conversations.id }),
});

/**
 * Removes every conversation stamped at or before the retention window's
 * edge, across every account; the schema cascades the rows beneath each.
 * Answers how many conversations went, descendants counted where they were
 * stamped themselves and not where the cascade alone took them.
 */
export function purgeClearedConversations(
  now: Date,
): Effect.Effect<number, ClearFailure, SqlClient.SqlClient> {
  const edge = new Date(now.getTime() - CLEARED_CONVERSATION_RETENTION_MS);
  return Effect.map(purgeRows(edge), (rows) => rows.length);
}
