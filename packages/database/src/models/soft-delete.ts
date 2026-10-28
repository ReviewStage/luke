import { and, inArray, isNull, lte } from "drizzle-orm";
import { DateTime, Duration, Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { conversations } from "../schemas/storage.js";
import { queueSessionSandboxes, sessionsOf } from "./session-sandbox-cleanup.js";

/**
 * The purge that follows a soft delete. Nothing is erased at the stamp: a
 * deleted task's agents' conversations are stamped `deleted_at`
 * (`task-store.ts`), so the reads — which skip a stamped row — show nothing
 * of them from the call after, while the rows stand until the purge. There is no archive, no
 * registry, and no cutoff: the stamp is the whole record, and the cron's
 * purge removes the stamped conversations seven days on, their messages,
 * turns, and events going with them by the schema's own cascade. Deleting
 * the account cascades everything at once, stamped or not. The eve session
 * a purged conversation ran in is queued in the same transaction for the
 * sweep to delete its sandbox (`session-sandbox-cleanup.ts`), since the
 * conversation's row is the last record that names it.
 *
 * A deleted agent's conversation is stamped the same way, by the same
 * statement (`stampConversationsDeleted`), so the two deletes keep one
 * promise about when the words go.
 */

/** How long a cleared conversation's rows stand before the purge takes them. */
export const CLEARED_CONVERSATION_RETENTION_MS = Duration.toMillis(Duration.days(7));

const IdRowSchema = Schema.Struct({ id: Schema.String });

const purgeRows = SqlSchema.findAll({
  Request: Schema.Date,
  Result: Schema.Struct({ id: Schema.String, runtimeSessionId: Schema.NullOr(Schema.String) }),
  execute: (edge) =>
    Database.use((db) =>
      db
        .delete(conversations)
        .where(lte(conversations.deletedAt, edge))
        .returning({ id: conversations.id, runtimeSessionId: conversations.runtimeSessionId }),
    ),
});

/**
 * Removes every conversation stamped at or before the retention window's
 * edge, across every account; the schema cascades the rows beneath each.
 * Answers how many conversations went, descendants counted where they were
 * stamped themselves and not where the cascade alone took them; the session
 * each ran in is queued for its sandbox's deletion as they go.
 */
export function purgeClearedConversations(
  now: Date,
): Effect.Effect<number, StoreFailure, DatabaseServices> {
  const edge = new Date(now.getTime() - CLEARED_CONVERSATION_RETENTION_MS);
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const rows = yield* purgeRows(edge);
        yield* queueSessionSandboxes(sessionsOf(rows));
        return rows.length;
      }),
    ),
  );
}

const stampRows = SqlSchema.findAll({
  Request: Schema.Struct({ conversationIds: Schema.Array(Schema.String), now: Schema.Date }),
  Result: IdRowSchema,
  execute: ({ conversationIds, now }) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({ deletedAt: now })
        .where(and(inArray(conversations.id, conversationIds), isNull(conversations.deletedAt)))
        .returning({ id: conversations.id }),
    ),
});

const findChildren = SqlSchema.findAll({
  Request: Schema.Array(Schema.String),
  Result: IdRowSchema,
  execute: (parentIds) =>
    Database.use((db) =>
      db
        .select({ id: conversations.id })
        .from(conversations)
        .where(inArray(conversations.parentConversationId, parentIds)),
    ),
});

/**
 * Stamps the conversations deleted now, and every conversation delegated
 * from them, a worker's under its agent's, so the reads skip them from the
 * call after and the purge takes them seven days on; one already stamped
 * keeps its stamp. Note that each child is stamped itself rather than left
 * to its parent's cascade, because the purge queues the sandbox of each row
 * it deletes by name (`purgeClearedConversations`) and a row the cascade
 * takes names none. By id alone, so the caller has gated the rows that
 * named them: a task's delete its agents', an agent's delete its own.
 */
export function stampConversationsDeleted(
  conversationIds: readonly string[],
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  if (conversationIds.length === 0) return Effect.void;
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const seen = new Set(conversationIds);
    let level: readonly string[] = conversationIds;
    while (level.length > 0) {
      yield* stampRows({ conversationIds: level, now });
      const children = yield* findChildren(level);
      level = children.map(({ id }) => id).filter((id) => !seen.has(id));
      for (const id of level) seen.add(id);
    }
  });
}
