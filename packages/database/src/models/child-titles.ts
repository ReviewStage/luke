import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { conversations } from "../schemas/storage.js";
import type { ConversationTarget } from "./writer.js";

type ChildTitleEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

const findTitles = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    parentConversationId: Schema.String,
    childConversationIds: Schema.Array(Schema.String),
  }),
  Result: Schema.Struct({ id: Schema.String, title: Schema.String }),
  execute: ({ userId, parentConversationId, childConversationIds }) =>
    Database.use((db) =>
      db
        .select({ id: conversations.id, title: conversations.title })
        .from(conversations)
        .where(
          and(
            inArray(conversations.id, [...childConversationIds]),
            eq(conversations.userId, userId),
            eq(conversations.parentConversationId, parentConversationId),
            isNotNull(conversations.title),
            isNull(conversations.deletedAt),
          ),
        ),
    ),
});

export function childTitlesOf(
  parent: ConversationTarget,
  childConversationIds: readonly string[],
): ChildTitleEffect<ReadonlyMap<string, string>> {
  if (childConversationIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findTitles({
      userId: parent.userId,
      parentConversationId: parent.conversationId,
      childConversationIds,
    }),
    (rows) => new Map(rows.map((row) => [row.id, row.title])),
  );
}
