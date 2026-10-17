/**
 * recorded-session.ts -- the conversation row's session, read, claimed, and locked without eve's code.
 *
 * The statements over a conversation's record that a handover to eve needs:
 * the eve session it runs in, where one has been recorded, and the
 * forward-only claim of a session for it. They stand apart from the
 * admission in `conversation.ts` on purpose. The admission reads the caller
 * through the door's authenticators, which import the eve package, and the
 * ask's bundle is the voice function, which talks to eve over HTTP and must
 * load nothing of eve's own code; a leaf with no path to the door is what
 * keeps that bundle free of it.
 *
 * Who reaches a conversation is decided here too, for the same bundle: the
 * account that opened it, and every member of the workspace of the task or
 * the coding agent that names it, or that names its parent, one hop up, which
 * is a subagent's session. The row's own `user_id` stays the opener's, the
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
import { alias } from "drizzle-orm/pg-core";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError, queryBuilder } from "../core/query.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { conversations } from "../schemas/storage.js";
import { task } from "../schemas/task.js";
import { CONVERSATION_KIND } from "../storage-vocabulary.js";
import { agentReachableBy, taskReachableBy } from "./workspace-store.js";
import type { ConversationTarget } from "./writer.js";

const StandingSessionSchema = Schema.Struct({
  runtimeSessionId: Schema.NullOr(Schema.String),
});

const OwnerRowSchema = Schema.Struct({ userId: Schema.String });

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
          and(
            eq(conversations.id, target.conversationId),
            eq(conversations.userId, target.userId),
            isNull(conversations.deletedAt),
          ),
        ),
    ),
});

const findConversationOwner = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: OwnerRowSchema,
  execute: (conversationId) =>
    Database.use((db) =>
      db
        .select({ userId: conversations.userId })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), isNull(conversations.deletedAt))),
    ),
});

/** The conversation a child conversation was delegated from, read beside the child. */
const parentConversation = alias(conversations, "parent_conversation");

/** The condition that a task or a coding agent, whichever workspace holds it, names this conversation as its own. */
function namedByWork(conversationId: SQLWrapper): SQL {
  const byTask = exists(
    queryBuilder.select({ one: task.id }).from(task).where(eq(task.conversationId, conversationId)),
  );
  const byAgent = exists(
    queryBuilder
      .select({ one: codingAgent.id })
      .from(codingAgent)
      .where(eq(codingAgent.conversationId, conversationId)),
  );
  return sql`(${byTask} or ${byAgent})`;
}

/** The condition that the conversation the row was delegated from still stands. */
function parentStands(): SQL {
  return exists(
    queryBuilder
      .select({ one: parentConversation.id })
      .from(parentConversation)
      .where(
        and(
          eq(parentConversation.id, conversations.parentConversationId),
          isNull(parentConversation.deletedAt),
        ),
      ),
  );
}

/** The condition that a task or a coding agent the account reaches through its workspace names this conversation as its own. */
function namedByReachableWork(userId: string, conversationId: SQLWrapper): SQL | undefined {
  return or(
    exists(
      queryBuilder
        .select({ one: task.id })
        .from(task)
        .where(and(eq(task.conversationId, conversationId), taskReachableBy(userId))),
    ),
    exists(
      queryBuilder
        .select({ one: codingAgent.id })
        .from(codingAgent)
        .where(and(eq(codingAgent.conversationId, conversationId), agentReachableBy(userId))),
    ),
  );
}

/**
 * The condition that the account reaches the standing conversation row a
 * statement reads: the conversation, or the standing one it was delegated
 * from, is a task's or a coding agent's in a workspace the account is a
 * member of; or it is the account's own and no task or agent names it or
 * its parent. Note that a conversation work names is reached through the
 * workspace alone, even by the member who opened it, because a member who
 * leaves the workspace leaves its tasks' conversations with it.
 */
function reachableConversation(userId: string): SQL | undefined {
  return and(
    isNull(conversations.deletedAt),
    or(
      and(
        eq(conversations.userId, userId),
        not(namedByWork(conversations.id)),
        or(
          isNull(conversations.parentConversationId),
          not(namedByWork(conversations.parentConversationId)),
        ),
      ),
      namedByReachableWork(userId, conversations.id),
      and(parentStands(), namedByReachableWork(userId, conversations.parentConversationId)),
    ),
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

const findReachableSession = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, runtimeSessionId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, runtimeSessionId }) =>
    Database.use((db) =>
      db
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(eq(conversations.runtimeSessionId, runtimeSessionId), reachableConversation(userId)),
        )
        .limit(1),
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
            isNull(conversations.deletedAt),
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
            isNull(conversations.deletedAt),
            isNotNull(conversations.runtimeSessionId),
            conversationIds === undefined ? undefined : inArray(conversations.id, conversationIds),
          ),
        ),
    ),
});

type ConversationKind = (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND];

/** An eve session a standing conversation of the account runs in, and the kind of conversation, which says which eve service runs it. */
export interface StandingSession {
  readonly sessionId: string;
  readonly kind: ConversationKind;
}

/**
 * The eve sessions the account's standing conversations run in: every one
 * of them, or those of the conversations named. A cleared conversation is
 * left out, since eve's door no longer admits anyone to its session.
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
 * The eve sessions the standing conversations named run in, whichever
 * member opened each: only for ids a gate already read, such as a shared
 * task's conversations as its delete gathers them.
 */
export function standingSessionsNamed(
  conversationIds: readonly string[],
): Effect.Effect<readonly StandingSession[], QueryError | Schema.SchemaError, DatabaseServices> {
  if (conversationIds.length === 0) return Effect.succeed([]);
  return findStandingSessions({ userId: null, conversationIds });
}

/** The eve session the account's own standing conversation runs in, where one has been recorded; a cleared or foreign conversation records none. */
export function recordedRuntimeSession(
  target: ConversationTarget,
): Effect.Effect<string | undefined, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(findStandingSession(target), (row) =>
    Option.isSome(row) ? (row.value.runtimeSessionId ?? undefined) : undefined,
  );
}

/** The account a standing conversation belongs to, which is whom its messages and turns are addressed under; nothing for a cleared or missing one. */
export function conversationOwnerOf(
  conversationId: string,
): Effect.Effect<Option.Option<string>, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(
    findConversationOwner(conversationId),
    Option.map((row) => row.userId),
  );
}

/** Whether a conversation stands and the account reaches it: its own, or its workspace's work. */
export function conversationReachableBy(
  userId: string,
  conversationId: string,
): Effect.Effect<boolean, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(findReachableConversation({ userId, conversationId }), Option.isSome);
}

/** Whether the account reaches the standing conversation that recorded this runtime session; no account reaches one none has recorded. */
export function runtimeSessionReachableBy(
  userId: string,
  runtimeSessionId: string,
): Effect.Effect<boolean, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(findReachableSession({ userId, runtimeSessionId }), Option.isSome);
}

/**
 * Claims the conversation for the eve session now starting, only forward:
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
