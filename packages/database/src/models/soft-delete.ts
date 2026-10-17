import { and, eq, inArray, isNotNull, lte, notExists, or } from "drizzle-orm";
import { Duration, Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { conversations } from "../schemas/storage.js";
import { task } from "../schemas/task.js";
import { voiceSessions } from "../schemas/voice.js";
import { queueSessionSandboxes, sessionsOf } from "./session-sandbox-cleanup.js";

/**
 * The purge that follows a soft delete. Nothing is erased at the stamp: a
 * deleted plan's conversation is stamped `deleted_at` (`task-store.ts`), so
 * the reads — which skip a stamped row — show nothing of it from the call
 * after, while the rows stand until the purge. There is no archive, no
 * registry, and no cutoff: the stamp is the whole record, and the cron's
 * purge removes the stamped conversations thirty days on, their messages,
 * turns, and events going with them by the schema's own cascade. Deleting
 * the account cascades everything at once, stamped or not. The eve session
 * a purged conversation ran in is queued in the same transaction for the
 * sweep to delete its sandbox (`session-sandbox-cleanup.ts`), since the
 * conversation's row is the last record that names it.
 *
 * A deleted plan's calls are not stamped: the delete removes the ones that
 * had ended (`task-store.ts`), and the cron removes each one left once it
 * has ended too, the words said on it going with it by the cascade.
 */

/** How long a cleared conversation's rows stand before the purge takes them. */
export const CLEARED_CONVERSATION_RETENTION_MS = Duration.toMillis(Duration.days(30));

type ClearFailure = QueryError | Schema.SchemaError;

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
): Effect.Effect<number, ClearFailure, DatabaseServices> {
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

/**
 * A call whose plan is gone, once it has ended: recorded closed, or started
 * before `liveEdge`, past which no Live session still runs whatever its row
 * says. A call no plan was ever named for is not one of a deleted plan.
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
 * Removes the ended calls of plans deleted since, across every account, at
 * most a sweep's worth; each call's segments cascade with it. Answers how
 * many calls went.
 */
export function purgeDeletedTaskCalls(
  liveEdge: Date,
): Effect.Effect<number, ClearFailure, DatabaseServices> {
  return Effect.map(purgeCallRows(liveEdge), (rows) => rows.length);
}
