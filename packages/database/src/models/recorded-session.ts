/**
 * recorded-session.ts -- the conversation row's session, read, claimed, and locked over the store alone.
 *
 * The statements over a conversation's record that a handover to its runtime
 * needs: the session it runs in, where one has been recorded, and the
 * forward-only claim of a session for it.
 *
 * Who reaches a conversation is decided here too, for the same bundle: the
 * account that opened it, and every member of the workspace of the coding
 * agent that names it, or that names its parent, one hop up, which is a
 * subagent's session. The row's own `user_id` stays the opener's, the
 * address every message, turn, and ask of it is written under.
 */

import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lt,
  not,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError, queryBuilder } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { conversations } from "../schemas/storage.js";
import { CONVERSATION_KIND } from "../storage-vocabulary.js";
import { agentReachableBy } from "./workspace-store.js";
import type { ConversationTarget } from "./writer.js";

const StandingSessionSchema = Schema.Struct({
  runtimeSessionId: Schema.NullOr(Schema.String),
});

const ClaimSchema = Schema.Struct({
  userId: Schema.String,
  conversationId: Schema.String,
  runtimeSessionId: Schema.String,
  now: Schema.Date,
});

const findStandingSession = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: StandingSessionSchema,
  execute: (target) =>
    Database.use((db) =>
      db
        .select({ runtimeSessionId: conversations.runtimeSessionId })
        .from(conversations)
        .where(
          and(eq(conversations.id, target.conversationId), eq(conversations.userId, target.userId)),
        ),
    ),
});

/** The condition that a coding agent, whichever workspace holds it, names this conversation as its own. */
function namedByWork(conversationId: SQLWrapper): SQL {
  return exists(
    queryBuilder
      .select({ one: agentTable.id })
      .from(agentTable)
      .where(eq(agentTable.conversationId, conversationId)),
  );
}

/** The condition that a coding agent the account reaches through its workspace names this conversation as its own. */
function namedByReachableWork(userId: string, conversationId: SQLWrapper): SQL {
  return exists(
    queryBuilder
      .select({ one: agentTable.id })
      .from(agentTable)
      .where(and(eq(agentTable.conversationId, conversationId), agentReachableBy(userId))),
  );
}

/**
 * The condition that the account reaches the conversation row a
 * statement reads: the conversation, or the one it was delegated
 * from, is a coding agent's in a workspace the account is a member of; or
 * it is the account's own and no agent names it or its parent. Note that a
 * conversation an agent names is reached through the workspace alone, even
 * by the member who opened it, because a member who leaves the workspace
 * leaves its agents' conversations with it. The per-task assistant's
 * conversation, and every worker's delegated from one, is reached by no
 * one: the migration that dropped its data stamped each of them deleted
 * (`20261021105816_per_task_luke_data_drop`), and the purge that followed
 * took them.
 */
function reachableConversation(userId: string): SQL | undefined {
  return or(
    and(
      eq(conversations.userId, userId),
      not(namedByWork(conversations.id)),
      or(
        isNull(conversations.parentConversationId),
        not(namedByWork(conversations.parentConversationId)),
      ),
    ),
    namedByReachableWork(userId, conversations.id),
    namedByReachableWork(userId, conversations.parentConversationId),
  );
}

const findReachableConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), reachableConversation(userId))),
    ),
});

const claimSession = SqlSchema.void({
  Request: ClaimSchema,
  execute: (claim) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({ runtimeSessionId: claim.runtimeSessionId, lastActivityAt: claim.now })
        .where(
          and(
            eq(conversations.id, claim.conversationId),
            eq(conversations.userId, claim.userId),
            or(
              isNull(conversations.runtimeSessionId),
              lt(conversations.runtimeSessionId, claim.runtimeSessionId),
            ),
          ),
        ),
    ),
});

const findRecordedSession = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: StandingSessionSchema,
  execute: (conversationId) =>
    Database.use((db) =>
      db
        .select({ runtimeSessionId: conversations.runtimeSessionId })
        .from(conversations)
        .where(eq(conversations.id, conversationId)),
    ),
});

const StandingSessionRowSchema = Schema.Struct({
  sessionId: Schema.String,
  kind: Schema.Literals(Object.values(CONVERSATION_KIND)),
});

const findStandingSessions = SqlSchema.findAll({
  Request: Schema.Struct({
    /** The account whose conversations are read; null for conversations a caller's gate already read. */
    userId: Schema.NullOr(Schema.String),
    conversationIds: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  Result: StandingSessionRowSchema,
  execute: ({ userId, conversationIds }) =>
    Database.use((db) =>
      db
        .select({
          sessionId: sql<string>`${conversations.runtimeSessionId}`,
          kind: conversations.kind,
        })
        .from(conversations)
        .where(
          and(
            userId === null ? undefined : eq(conversations.userId, userId),
            isNotNull(conversations.runtimeSessionId),
            conversationIds === undefined ? undefined : inArray(conversations.id, conversationIds),
          ),
        ),
    ),
});

type ConversationKind = (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND];

/** A runtime session a standing conversation of the account runs in, and the kind of conversation. */
export interface StandingSession {
  readonly sessionId: string;
  readonly kind: ConversationKind;
}

/**
 * The runtime sessions the account's standing conversations run in: every one
 * of them, or those of the conversations named. A cleared conversation is
 * left out.
 */
export function standingSessionsOf(
  userId: string,
  conversationIds?: readonly string[],
): Effect.Effect<readonly StandingSession[], QueryError | Schema.SchemaError, DatabaseServices> {
  if (conversationIds !== undefined && conversationIds.length === 0) return Effect.succeed([]);
  return findStandingSessions({
    userId,
    ...(conversationIds === undefined ? undefined : { conversationIds }),
  });
}

/**
 * The runtime sessions the standing conversations named run in, whichever
 * member opened each: only for ids a gate already read, such as a shared
 * task's agents' conversations as its delete gathers them.
 */
export function standingSessionsNamed(
  conversationIds: readonly string[],
): Effect.Effect<readonly StandingSession[], QueryError | Schema.SchemaError, DatabaseServices> {
  if (conversationIds.length === 0) return Effect.succeed([]);
  return findStandingSessions({ userId: null, conversationIds });
}

/** The runtime session the account's own standing conversation runs in, where one has been recorded; a cleared or foreign conversation records none. */
export function recordedRuntimeSession(
  target: ConversationTarget,
): Effect.Effect<string | undefined, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(findStandingSession(target), (row) =>
    Option.isSome(row) ? (row.value.runtimeSessionId ?? undefined) : undefined,
  );
}

/** Whether a conversation stands and the account reaches it: its own, or its workspace's work. */
export function conversationReachableBy(
  userId: string,
  conversationId: string,
): Effect.Effect<boolean, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(findReachableConversation({ userId, conversationId }), Option.isSome);
}

/**
 * Claims the conversation for the runtime session now starting, only forward:
 * the row takes the id when it records none or an older one, and a start
 * replayed for a session the conversation has since rotated away from
 * changes nothing. Answers whether the row now records this session.
 */
export const claimRuntimeSession = /* @__PURE__ */ Effect.fn("web/claimRuntimeSession")(function* (
  target: ConversationTarget,
  runtimeSessionId: string,
  now: Date,
): Effect.fn.Return<boolean, QueryError | Schema.SchemaError, DatabaseServices> {
  yield* claimSession({ ...target, runtimeSessionId, now });
  const recorded = yield* findRecordedSession(target.conversationId);
  return Option.isSome(recorded) && recorded.value.runtimeSessionId === runtimeSessionId;
});
