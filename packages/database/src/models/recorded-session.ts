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
 */

import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import type { SqlClient } from "effect/sql";
import { SqlSchema } from "effect/sql";
import type { SqlError } from "effect/sql/SqlError";
import { db } from "../core/query.js";
import { conversations } from "../schemas/storage.js";
import { CONVERSATION_KIND } from "../storage-vocabulary.js";
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

const StandingSessionRowSchema = Schema.Struct({
  sessionId: Schema.String,
  kind: Schema.Literals(Object.values(CONVERSATION_KIND)),
});

const findStandingSessions = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationIds: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  Result: StandingSessionRowSchema,
  execute: ({ userId, conversationIds }) =>
    db
      .select({
        sessionId: sql<string>`${conversations.runtimeSessionId}`,
        kind: conversations.kind,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.userId, userId),
          isNull(conversations.deletedAt),
          isNotNull(conversations.runtimeSessionId),
          conversationIds === undefined ? undefined : inArray(conversations.id, conversationIds),
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
): Effect.Effect<readonly StandingSession[], SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  if (conversationIds !== undefined && conversationIds.length === 0) return Effect.succeed([]);
  return findStandingSessions({
    userId,
    ...(conversationIds === undefined ? undefined : { conversationIds }),
  });
}

/** The eve session the account's own standing conversation runs in, where one has been recorded; a cleared or foreign conversation records none. */
export function recordedRuntimeSession(
  target: ConversationTarget,
): Effect.Effect<string | undefined, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  return Effect.map(findStandingSession(target), (row) =>
    Option.isSome(row) ? (row.value.runtimeSessionId ?? undefined) : undefined,
  );
}

/** Whether a conversation stands and belongs to the account. */
export function conversationOwnedBy(
  userId: string,
  conversationId: string,
): Effect.Effect<boolean, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  return Effect.map(
    findConversationOwner(conversationId),
    (found) => Option.isSome(found) && found.value.userId === userId,
  );
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
