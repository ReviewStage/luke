import { and, eq, inArray, isNotNull, isNull, lte, notExists, or } from "drizzle-orm";
import { DateTime, Duration, Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { conversations } from "../schemas/storage.js";
import { task } from "../schemas/task.js";
import { voiceSessions } from "../schemas/voice.js";
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
 *
 * A deleted task's calls are not stamped: the delete removes the ones that
 * had ended (`task-store.ts`), and the cron removes each one left once it
 * has ended too, the words said on it going with it by the cascade.
 */

/** How long a cleared conversation's rows stand before the purge takes them. */
export const CLEARED_CONVERSATION_RETENTION_MS = Duration.toMillis(Duration.days(7));

/** The most calls one sweep removes, so a backlog is worked through a sweep at a time rather than in one statement. */
const DELETED_TASK_CALLS_PER_SWEEP = 200;

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

/**
 * A call whose task is gone, once it has ended: recorded closed, or started
 * before `liveEdge`, past which no Live session still runs whatever its row
 * says. A call no task was ever named for is not one of a deleted task.
 */
const purgeCallRows = SqlSchema.findAll({
  Request: Schema.Date,
  Result: IdRowSchema,
  execute: (liveEdge) =>
    Database.use((db) =>
      db
        .delete(voiceSessions)
        .where(
          inArray(
            voiceSessions.id,
            db
              .select({ id: voiceSessions.id })
              .from(voiceSessions)
              .where(
                and(
                  isNotNull(voiceSessions.taskId),
                  notExists(
                    db.select({ id: task.id }).from(task).where(eq(task.id, voiceSessions.taskId)),
                  ),
                  or(isNotNull(voiceSessions.closedAt), lte(voiceSessions.startedAt, liveEdge)),
                ),
              )
              .limit(DELETED_TASK_CALLS_PER_SWEEP),
          ),
        )
        .returning({ id: voiceSessions.id }),
    ),
});

/**
 * Removes the ended calls of tasks deleted since, across every account, at
 * most a sweep's worth; each call's segments cascade with it. Answers how
 * many calls went.
 */
export function purgeDeletedTaskCalls(
  liveEdge: Date,
): Effect.Effect<number, StoreFailure, DatabaseServices> {
  return Effect.map(purgeCallRows(liveEdge), (rows) => rows.length);
}
