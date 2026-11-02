import { Database, type DatabaseServices, type QueryError } from "@luke/database/core/query";
import type { ConversationTarget } from "@luke/database/models/writer";
import { conversations } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { Effect, type Result, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import type { EveHostRefusal } from "./bounds.js";

export {
  claimRuntimeSession,
  conversationReachableBy,
  runtimeSessionReachableBy,
} from "@luke/database/models/recorded-session";

/**
 * The conversation an agent's call was admitted to (`../luke-mcp/bearer.ts`
 * admits a runner's bearer to its own): the account it acts for, which
 * gates every read, is metered, and binds the tools, and the conversation's
 * owner, the opener, whose id addresses its rows.
 */
export interface AdmittedConversation {
  /** The account the current request acts for: it reads, pays, and acts through the tools. */
  readonly caller: string;
  /** The conversation as the store addresses it, under the account that opened it. */
  readonly target: ConversationTarget;
  /** The session id the conversation row last recorded, where one has been. */
  readonly runtimeSessionId: string | undefined;
  /** The time zone the current request named, which the turn reads the developer's day in; none reads UTC. */
  readonly timeZone: string | undefined;
}

/** The conversation the session was admitted to, or the one word for why it was not. */
export type ConversationAdmission = Result.Result<AdmittedConversation, EveHostRefusal>;

const insertChildConversation = SqlSchema.findAll({
  Request: Schema.Struct({
    id: Schema.String,
    userId: Schema.String,
    parentConversationId: Schema.String,
    label: Schema.String,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ id, userId, parentConversationId, label }) =>
    Database.use((db) =>
      db
        .insert(conversations)
        .values({
          id,
          userId,
          kind: CONVERSATION_KIND.CHILD,
          parentConversationId,
          label,
          expectsCompletion: false,
        })
        .onConflictDoNothing({ target: conversations.id })
        .returning({ id: conversations.id }),
    ),
});

/**
 * The child conversation a subagent's session is recorded in, opened beside
 * its parent's the first time the subagent's task starts a turn and left as
 * it stands every time after. It owes its parent no completion: eve hands
 * the subagent's findings to the parent turn itself, so `expectsCompletion`
 * is false and no completion sweep reads it.
 */
export function openChildConversation(
  parent: ConversationTarget,
  childId: string,
  label: string,
): Effect.Effect<void, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.asVoid(
    insertChildConversation({
      id: childId,
      userId: parent.userId,
      parentConversationId: parent.conversationId,
      label,
    }),
  );
}
