import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { ConversationTarget } from "../store/index.js";

/**
 * The statements over a conversation's record that a handover to eve needs:
 * the eve session it runs in, where one has been recorded, and the
 * forward-only claim of a session for it. They stand apart from the
 * admission in `conversation.ts` on purpose. The admission reads the caller
 * through the door's authenticators, which import the eve package, and the
 * opener's bundle is the scheduled tick's function, which talks to eve over
 * HTTP and must load nothing of eve's own code; a leaf with no path to the
 * door is what keeps the tick's bundle free of it.
 */

const StandingSessionSchema = Schema.Struct({
  runtimeSessionId: Schema.NullOr(Schema.String),
}).pipe(Schema.encodeKeys({ runtimeSessionId: "runtime_session_id" }));

const findStandingSession = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: StandingSessionSchema,
  execute: (target) =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`
        select runtime_session_id
        from conversations
        where id = ${target.conversationId} and user_id = ${target.userId} and deleted_at is null
      `,
    ),
});

/** The eve session the account's own standing conversation runs in, where one has been recorded; a cleared or foreign conversation records none. */
export function recordedRuntimeSession(
  target: ConversationTarget,
): Effect.Effect<string | undefined, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  return Effect.map(findStandingSession(target), (row) =>
    Option.isSome(row) ? (row.value.runtimeSessionId ?? undefined) : undefined,
  );
}

const OwnerRowSchema = Schema.Struct({
  userId: Schema.String,
}).pipe(Schema.encodeKeys({ userId: "user_id" }));

const findConversationOwner = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: OwnerRowSchema,
  execute: (conversationId) =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`
        select user_id
        from conversations
        where id = ${conversationId} and deleted_at is null
      `,
    ),
});

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

const ClaimSchema = Schema.Struct({
  userId: Schema.String,
  conversationId: Schema.String,
  runtimeSessionId: Schema.String,
  now: Schema.Date,
});

const claimSession = SqlSchema.void({
  Request: ClaimSchema,
  execute: (claim) =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`
        update conversations
        set runtime_session_id = ${claim.runtimeSessionId}, last_activity_at = ${claim.now}
        where id = ${claim.conversationId}
          and user_id = ${claim.userId}
          and deleted_at is null
          and (runtime_session_id is null or runtime_session_id < ${claim.runtimeSessionId})
      `,
    ),
});

const findRecordedSession = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: StandingSessionSchema,
  execute: (conversationId) =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`
        select runtime_session_id from conversations where id = ${conversationId}
      `,
    ),
});

/**
 * Claims the conversation for the eve session now starting, only forward:
 * the row takes the id when it records none or an older one, and a start
 * replayed for a session the conversation has since rotated away from
 * changes nothing. Answers whether the row now records this session.
 */
export const claimRuntimeSession = /* @__PURE__ */ Effect.fn("claimRuntimeSession")(function* (
  target: ConversationTarget,
  runtimeSessionId: string,
  now: Date,
): Effect.fn.Return<boolean, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  yield* claimSession({ ...target, runtimeSessionId, now });
  const recorded = yield* findRecordedSession(target.conversationId);
  return Option.isSome(recorded) && recorded.value.runtimeSessionId === runtimeSessionId;
});
