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
 * account that opened it, and every member of the workspace of the plan or
 * the coding agent that names it, or that names its parent, one hop up, which
 * is a subagent's session. The row's own `user_id` stays the opener's, the
 * address every message, turn, and ask of it is written under.
 */

import { and, eq, exists, isNull, lt, or, type SQL, type SQLWrapper } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { codingAgent } from "../../db/coding-agent-schema.js";
import { plan } from "../../db/plan-schema.js";
import { db } from "../../db/query.js";
import { conversations } from "../../db/storage-schema.js";
import type { ConversationTarget } from "../store/index.js";
import { planReachableBy } from "../workspace-store.js";

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
});

const findConversationOwner = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: OwnerRowSchema,
  execute: (conversationId) =>
    db
      .select({ userId: conversations.userId })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), isNull(conversations.deletedAt))),
});

/** The condition that a plan or a coding agent the account reaches through its workspace names this conversation as its own. */
function namedByReachableWork(userId: string, conversationId: SQLWrapper): SQL | undefined {
  return or(
    exists(
      db
        .select({ one: plan.id })
        .from(plan)
        .where(and(eq(plan.conversationId, conversationId), planReachableBy(userId))),
    ),
    exists(
      db
        .select({ one: codingAgent.id })
        .from(codingAgent)
        .innerJoin(plan, eq(plan.id, codingAgent.planId))
        .where(and(eq(codingAgent.conversationId, conversationId), planReachableBy(userId))),
    ),
  );
}

/**
 * The condition that the account reaches the standing conversation row a
 * statement reads: it opened it, or the conversation, or the one it was
 * delegated from, is a plan's or a coding agent's in a workspace the account
 * is a member of.
 */
function reachableConversation(userId: string): SQL | undefined {
  return and(
    isNull(conversations.deletedAt),
    or(
      eq(conversations.userId, userId),
      namedByReachableWork(userId, conversations.id),
      namedByReachableWork(userId, conversations.parentConversationId),
    ),
  );
}

const findReachableConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, conversationId }) =>
    db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), reachableConversation(userId))),
});

const findReachableSession = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, runtimeSessionId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, runtimeSessionId }) =>
    db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(eq(conversations.runtimeSessionId, runtimeSessionId), reachableConversation(userId)),
      )
      .limit(1),
});

const claimSession = SqlSchema.void({
  Request: ClaimSchema,
  execute: (claim) =>
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
});

const findRecordedSession = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: StandingSessionSchema,
  execute: (conversationId) =>
    db
      .select({ runtimeSessionId: conversations.runtimeSessionId })
      .from(conversations)
      .where(eq(conversations.id, conversationId)),
});

/** The eve session the account's own standing conversation runs in, where one has been recorded; a cleared or foreign conversation records none. */
export function recordedRuntimeSession(
  target: ConversationTarget,
): Effect.Effect<string | undefined, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  return Effect.map(findStandingSession(target), (row) =>
    Option.isSome(row) ? (row.value.runtimeSessionId ?? undefined) : undefined,
  );
}

/** The account a standing conversation belongs to, which is whom its messages and turns are addressed under; nothing for a cleared or missing one. */
export function conversationOwnerOf(
  conversationId: string,
): Effect.Effect<Option.Option<string>, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  return Effect.map(
    findConversationOwner(conversationId),
    Option.map((row) => row.userId),
  );
}

/** Whether a conversation stands and the account reaches it: its own, or its workspace's work. */
export function conversationReachableBy(
  userId: string,
  conversationId: string,
): Effect.Effect<boolean, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  return Effect.map(findReachableConversation({ userId, conversationId }), Option.isSome);
}

/** Whether the account reaches the standing conversation that recorded this runtime session; no account reaches one none has recorded. */
export function runtimeSessionReachableBy(
  userId: string,
  runtimeSessionId: string,
): Effect.Effect<boolean, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
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
): Effect.fn.Return<boolean, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  yield* claimSession({ ...target, runtimeSessionId, now });
  const recorded = yield* findRecordedSession(target.conversationId);
  return Option.isSome(recorded) && recorded.value.runtimeSessionId === runtimeSessionId;
});
