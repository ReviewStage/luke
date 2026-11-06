import { and, inArray, isNull, lte } from "drizzle-orm";
import { DateTime, Duration, Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { conversations } from "../schemas/storage.js";
import { queueSessionSandboxes, sessionsOf } from "./session-sandbox-cleanup.js";

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
