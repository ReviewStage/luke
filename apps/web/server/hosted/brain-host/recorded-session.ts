/**
 * recorded-session.ts -- the conversation row's session, read, claimed, and locked without eve's code.
 *
 * The statements over a conversation's record that a handover to eve needs:
 * the eve session it runs in, where one has been recorded; the forward-only
 * claim of a session for it; and its row lock. They stand apart from the
 * admission in `conversation.ts` on purpose. The admission reads the caller
 * through the door's authenticators, which import the eve package, and the
 * opener's bundle is the scheduled tick's function, which talks to eve over
 * HTTP and must load nothing of eve's own code; a leaf with no path to the
 * door is what keeps the tick's bundle free of it.
 */

import { and, eq, isNull, lt, or } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { db } from "../../db/query.js";
import { conversations } from "../../db/storage-schema.js";
import type { ConversationTarget } from "../store/index.js";

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

const lockRow = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (target) =>
    db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, target.conversationId),
          eq(conversations.userId, target.userId),
          isNull(conversations.deletedAt),
        ),
      )
      .for("update"),
});

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

/**
 * The conversation's row lock, the same one an ask's dispatch takes, for a
 * caller inside a transaction about to hand eve a turn: two handovers into
 * a conversation with no session would each open one, and the one the
 * forward-only claim loses would never have its turn read, so the second
 * waits here, reads the session the first opened, and sends into it.
 * Answers whether the row stands for the account.
 */
export function lockConversationRow(
  target: ConversationTarget,
): Effect.Effect<boolean, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  return Effect.map(lockRow(target), Option.isSome);
}
