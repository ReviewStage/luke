import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { type Effect, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { db } from "../../db/query.js";
import { conversations } from "../../db/storage-schema.js";
import { CONVERSATION_KIND } from "../../db/storage-vocabulary.js";
import { InstantColumnSchema } from "./database.js";

type StandingConversationFailure = SqlError | Schema.SchemaError;

/**
 * One of the account's conversations as the brain's own `sessions_list`
 * names it: the row's kind, the label a delegation gave a child, the session
 * an observed conversation observes, and when it was opened and last
 * written to. A child's row is listed here, since the brain lists its own
 * conversations; a thread's is not, and nothing hosted opens one.
 */
export interface ConversationDirectoryEntry {
  readonly id: string;
  readonly kind:
    | typeof CONVERSATION_KIND.MAIN
    | typeof CONVERSATION_KIND.OBSERVED
    | typeof CONVERSATION_KIND.CHILD;
  readonly label: string | null;
  readonly providerSessionId: string | null;
  readonly createdAt: Date;
  readonly lastActivityAt: Date;
}

const ConversationDirectoryRowSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals([
    CONVERSATION_KIND.MAIN,
    CONVERSATION_KIND.OBSERVED,
    CONVERSATION_KIND.CHILD,
  ]),
  label: Schema.NullOr(Schema.String),
  providerSessionId: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
  lastActivityAt: InstantColumnSchema,
});

const findConversationDirectory = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, limit: Schema.Number }),
  Result: ConversationDirectoryRowSchema,
  execute: (request) =>
    db
      .select({
        id: conversations.id,
        kind: conversations.kind,
        label: conversations.label,
        providerSessionId: conversations.providerSessionId,
        createdAt: conversations.createdAt,
        lastActivityAt: conversations.lastActivityAt,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.userId, request.userId),
          inArray(conversations.kind, [
            CONVERSATION_KIND.MAIN,
            CONVERSATION_KIND.OBSERVED,
            CONVERSATION_KIND.CHILD,
          ]),
          isNull(conversations.deletedAt),
        ),
      )
      .orderBy(desc(conversations.lastActivityAt), asc(conversations.id))
      .limit(request.limit),
});

/** The account's standing main, observed, and child conversations, most recently written to first and at most `limit` of them. */
export function conversationDirectory(
  userId: string,
  limit: number,
): Effect.Effect<
  readonly ConversationDirectoryEntry[],
  StandingConversationFailure,
  SqlClient.SqlClient
> {
  return findConversationDirectory({ userId, limit });
}
