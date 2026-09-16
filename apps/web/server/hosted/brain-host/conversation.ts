import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { SessionAuth } from "eve/context";
import { CONVERSATION_KIND } from "../../db/storage-vocabulary.js";
import type { ConversationTarget } from "../store/index.js";
import { actedForAccount, conversationIdOf } from "./auth.js";
import { BRAIN_HOST_REFUSAL, type BrainHostRefusal } from "./bounds.js";

export { claimRuntimeSession, conversationOwnedBy } from "./recorded-session.js";

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
type ConversationFailure = SqlError | Schema.SchemaError;

/**
 * A statement over the ambient client, so the query below reads as the query
 * it is. The one module of LUKE-258's sixth batch left on a raw statement:
 * `admitConversation` runs before every eve event, and a bridged statement's
 * promise door (`db/drizzle.ts`) leaves the hook's remaining steps in a
 * different `AsyncLocalStorage` context than eve's own session container, so
 * the relay's `defineState` accessors read and write the wrong one and no
 * turn ever settles. A follow-up converts this file once that door is fixed.
 */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

/** How a session stands to the conversation's record: it must be the recorded session, or it is the one claiming the record now. */
export const SESSION_STANDING = {
  CURRENT: "current",
  CLAIMING: "claiming",
} as const;

type SessionStanding = (typeof SESSION_STANDING)[keyof typeof SESSION_STANDING];

const ConversationRowSchema = Schema.Struct({
  userId: Schema.String,
  kind: Schema.Literals(Object.values(CONVERSATION_KIND)),
  runtimeSessionId: Schema.NullOr(Schema.String),
}).pipe(Schema.encodeKeys({ userId: "user_id", runtimeSessionId: "runtime_session_id" }));

const OwnerRowSchema = Schema.Struct({
  userId: Schema.String,
}).pipe(Schema.encodeKeys({ userId: "user_id" }));

const findConversation = SqlSchema.findOneOption({
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

const findRuntimeSessionOwner = SqlSchema.findOneOption({
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

/** The account whose standing conversation recorded this runtime session; nothing while none has. */
export function runtimeSessionOwner(
  runtimeSessionId: string,
): Effect.Effect<string | undefined, ConversationFailure, SqlClient.SqlClient> {
  return Effect.map(findRuntimeSessionOwner(runtimeSessionId), (found) =>
    Option.getOrUndefined(Option.map(found, (row) => row.userId)),
  );
}
