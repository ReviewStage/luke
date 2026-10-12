/**
 * child-titles.ts -- a subagent's title on the child conversation its session is recorded in, filled once and read by its parent's readers.
 *
 * A planning worker and a coding agent's worker are each one child
 * conversation, so the title generated from the task it was handed is
 * written on that row (`coder-host/title.ts`), filled only where none
 * stands, and read back under the parent: a child of another account's, of
 * another parent's, or cleared reads as untitled. A leaf over the store
 * alone, so the routes that read a plan's work reach none of eve's code.
 */

import { db } from "@sidecar/database/core/query";
import type { ConversationTarget } from "@sidecar/database/models/writer";
import { conversations } from "@sidecar/database/schemas/storage";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";

type ChildTitleEffect<A> = Effect.Effect<A, SqlError | Schema.SchemaError, SqlClient.SqlClient>;

const fillTitle = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    parentConversationId: Schema.String,
    childConversationId: Schema.String,
    title: Schema.String,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, parentConversationId, childConversationId, title }) =>
    db
      .update(conversations)
      .set({ title })
      .where(
        and(
          eq(conversations.id, childConversationId),
          eq(conversations.userId, userId),
          eq(conversations.parentConversationId, parentConversationId),
          isNull(conversations.title),
          isNull(conversations.deletedAt),
        ),
      )
      .returning({ id: conversations.id }),
});

const findTitles = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    parentConversationId: Schema.String,
    childConversationIds: Schema.Array(Schema.String),
  }),
  Result: Schema.Struct({ id: Schema.String, title: Schema.String }),
  execute: ({ userId, parentConversationId, childConversationIds }) =>
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
});

/** The title written on this child of the account's conversation where it has none yet; answers whether it was written. */
export function fillChildTitle(
  parent: ConversationTarget,
  childConversationId: string,
  title: string,
): ChildTitleEffect<boolean> {
  return Effect.map(
    fillTitle({
      userId: parent.userId,
      parentConversationId: parent.conversationId,
      childConversationId,
      title,
    }),
    (rows) => rows.length > 0,
  );
}

/** The title of each of these children of the account's conversation that has one, by child; none asked, none read. */
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

/** The title of each child named that has one, by the call the caller names its child by, since several calls may share one child. */
export function childTitlesByCall(
  parent: ConversationTarget,
  childByCall: ReadonlyMap<string, string>,
): ChildTitleEffect<ReadonlyMap<string, string>> {
  return Effect.map(childTitlesOf(parent, [...new Set(childByCall.values())]), (titles) => {
    const byCall = new Map<string, string>();
    for (const [callId, child] of childByCall) {
      const title = titles.get(child);
      if (title !== undefined) byCall.set(callId, title);
    }
    return byCall;
  });
}
