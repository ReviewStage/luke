import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Option, type ParseResult, Schema } from "effect";
import type { SessionAuth } from "eve/context";
import { CONVERSATION_KIND } from "../../db/storage-schema.js";
import type { ConversationTarget } from "../store/index.js";
import { actedForAccount, conversationIdOf } from "./auth.js";
import { BRAIN_HOST_REFUSAL, type BrainHostRefusal } from "./bounds.js";

/**
 * The host's own check of who a session is for. eve authenticates a request
 * and pins the caller who created a session as its initiator, but it knows
 * nothing of conversations: which account a conversation belongs to is a
 * fact of the store, and the host enforces it here, before every tool call
 * and every write. A session is admitted for a conversation only when the
 * conversation the session was opened for exists, is not cleared, belongs to
 * the current caller, and the current caller is the one who opened the
 * session, so account B can neither speak into A's session nor be shown A's
 * rows through it. A conversation runs in one eve session at a time, the
 * one its row records: a session that is not the recorded one — one the
 * conversation rotated away from, whose hooks may still be firing — is
 * refused too, so two sessions never write one conversation. The record is
 * claimed by the session's own start, and only forward: eve's session ids
 * sort by the instant they were minted, so a start replayed for an older
 * session finds a newer one recorded and claims nothing.
 */

type ConversationKind = (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND];

export interface AdmittedConversation {
  readonly ok: true;
  readonly target: ConversationTarget;
  readonly kind: ConversationKind;
  /** The eve session id the conversation row last recorded, where one has been. */
  readonly runtimeSessionId: string | undefined;
}

export type ConversationAdmission =
  | AdmittedConversation
  | { readonly ok: false; readonly refusal: BrainHostRefusal };

/** How a read here fails: the driver's own refusal, or a row the schema refused. */
type ConversationFailure = SqlError | ParseResult.ParseError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

/** How a session stands to the conversation's record: it must be the recorded session, or it is the one claiming the record now. */
export const SESSION_STANDING = {
  CURRENT: "current",
  CLAIMING: "claiming",
} as const;

type SessionStanding = (typeof SESSION_STANDING)[keyof typeof SESSION_STANDING];

const ConversationRowSchema = Schema.Struct({
  userId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("user_id")),
  kind: Schema.Literal(...Object.values(CONVERSATION_KIND)),
  runtimeSessionId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("runtime_session_id"),
  ),
});

const OwnerRowSchema = Schema.Struct({
  userId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("user_id")),
});

const RecordedSessionSchema = Schema.Struct({
  runtimeSessionId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("runtime_session_id"),
  ),
});

const findConversation = SqlSchema.findOne({
  Request: Schema.String,
  Result: ConversationRowSchema,
  execute: (conversationId) =>
    statement(
      (sql) => sql`
        select user_id, kind, runtime_session_id
        from conversations
        where id = ${conversationId} and deleted_at is null
      `,
    ),
});

const findRuntimeSessionOwner = SqlSchema.findOne({
  Request: Schema.String,
  Result: OwnerRowSchema,
  execute: (runtimeSessionId) =>
    statement(
      (sql) => sql`
        select user_id
        from conversations
        where runtime_session_id = ${runtimeSessionId} and deleted_at is null
      `,
    ),
});

const findConversationOwner = SqlSchema.findOne({
  Request: Schema.String,
  Result: OwnerRowSchema,
  execute: (conversationId) =>
    statement(
      (sql) => sql`
        select user_id
        from conversations
        where id = ${conversationId} and deleted_at is null
      `,
    ),
});

const ClaimSchema = Schema.Struct({
  userId: Schema.String,
  conversationId: Schema.String,
  runtimeSessionId: Schema.String,
  now: Schema.DateFromSelf,
});

const claimSession = SqlSchema.void({
  Request: ClaimSchema,
  execute: (claim) =>
    statement(
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

const findRecordedSession = SqlSchema.findOne({
  Request: Schema.String,
  Result: RecordedSessionSchema,
  execute: (conversationId) =>
    statement(
      (sql) => sql`
        select runtime_session_id from conversations where id = ${conversationId}
      `,
    ),
});

export function admitConversation(
  auth: SessionAuth,
  session: { readonly id: string; readonly standing: SessionStanding },
): Effect.Effect<ConversationAdmission, ConversationFailure, SqlClient.SqlClient> {
  const current = auth.current;
  const account = actedForAccount(current);
  if (!current || account === undefined) {
    return Effect.succeed({ ok: false, refusal: BRAIN_HOST_REFUSAL.NO_PRINCIPAL });
  }
  const initiator = auth.initiator ?? current;
  if (actedForAccount(initiator) !== account) {
    return Effect.succeed({ ok: false, refusal: BRAIN_HOST_REFUSAL.NOT_INITIATOR });
  }
  const conversationId = conversationIdOf(initiator);
  if (!conversationId)
    return Effect.succeed({ ok: false, refusal: BRAIN_HOST_REFUSAL.NO_CONVERSATION });
  return Effect.map(findConversation(conversationId), (found) => {
    if (Option.isNone(found)) return { ok: false, refusal: BRAIN_HOST_REFUSAL.NO_CONVERSATION };
    const row = found.value;
    if (row.userId !== account) {
      return { ok: false, refusal: BRAIN_HOST_REFUSAL.NOT_OWNER };
    }
    if (session.standing === SESSION_STANDING.CURRENT && row.runtimeSessionId !== session.id) {
      return { ok: false, refusal: BRAIN_HOST_REFUSAL.NOT_CURRENT_SESSION };
    }
    return {
      ok: true,
      target: { userId: row.userId, conversationId },
      kind: row.kind,
      runtimeSessionId: row.runtimeSessionId ?? undefined,
    };
  });
}

/** The eve session the conversation's row records it running in; nothing while no session has claimed it. */

/** The account whose standing conversation recorded this runtime session; nothing while none has. */
export function runtimeSessionOwner(
  runtimeSessionId: string,
): Effect.Effect<string | undefined, ConversationFailure, SqlClient.SqlClient> {
  return Effect.map(findRuntimeSessionOwner(runtimeSessionId), (found) =>
    Option.getOrUndefined(Option.map(found, (row) => row.userId)),
  );
}

/** Whether a conversation stands and belongs to the account. */
export function conversationOwnedBy(
  userId: string,
  conversationId: string,
): Effect.Effect<boolean, ConversationFailure, SqlClient.SqlClient> {
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
export function claimRuntimeSession(
  target: ConversationTarget,
  runtimeSessionId: string,
  now: Date,
): Effect.Effect<boolean, ConversationFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    yield* claimSession({ ...target, runtimeSessionId, now });
    const recorded = yield* findRecordedSession(target.conversationId);
    return Option.isSome(recorded) && recorded.value.runtimeSessionId === runtimeSessionId;
  });
}
