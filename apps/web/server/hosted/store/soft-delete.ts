import { and, inArray, isNull, lte } from "drizzle-orm";
import { Duration, Effect, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { db } from "../../db/query.js";
import { conversations } from "../../db/storage-schema.js";

/**
 * The soft delete and the purge that follows it. Nothing is erased at the
 * stamp: a conversation is stamped `deleted_at`, every descendant of it with
 * it, so the reads — which skip a stamped row — show nothing of it from the
 * call after, while the rows stand until the purge. There is no archive, no
 * registry, and no cutoff: the stamp is the whole record, and the cron's
 * purge removes the stamped conversations thirty days on, their messages,
 * turns, events, and children going with them by the schema's own cascade.
 * Deleting the account cascades everything at once, stamped or not.
 */

/** How long a cleared conversation's rows stand before the purge takes them. */
export const CLEARED_CONVERSATION_RETENTION_MS = Duration.toMillis(Duration.days(30));

type ClearFailure = SqlError | Schema.SchemaError;

const IdRowSchema = Schema.Struct({ id: Schema.String });

const StampChildrenSchema = Schema.Struct({
  parents: Schema.Array(Schema.String),
  deletedAt: Schema.Date,
});

const stampChildren = SqlSchema.findAll({
  Request: StampChildrenSchema,
  Result: IdRowSchema,
  execute: (write) =>
    db
      .update(conversations)
      .set({ deletedAt: write.deletedAt })
      .where(
        and(
          inArray(conversations.parentConversationId, [...write.parents]),
          isNull(conversations.deletedAt),
        ),
      )
      .returning({ id: conversations.id }),
});

/** Stamps every not-yet-stamped child of the given rows, level by level, and answers every id stamped. */
export const stampDescendants = /* @__PURE__ */ Effect.fn("web/stampDescendants")(function* (
  parents: readonly string[],
  deletedAt: Date,
): Effect.fn.Return<string[], ClearFailure, SqlClient.SqlClient> {
  const stamped: string[] = [];
  let frontier = parents;
  while (frontier.length > 0) {
    const children = yield* stampChildren({ parents: [...frontier], deletedAt });
    frontier = children.map((child) => child.id);
    stamped.push(...frontier);
  }
  return stamped;
});

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
