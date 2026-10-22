import { Database, type DatabaseServices, type QueryError } from "@luke/database/core/query";
import { conversationReachableBy } from "@luke/database/models/recorded-session";
import type { ConversationTarget } from "@luke/database/models/writer";
import { conversations } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { and, eq, isNull } from "drizzle-orm";
import { Effect, Option, Result, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import type { SessionAuth } from "eve/context";
import { actedForAccount, conversationIdOf, timeZoneOf } from "./auth.js";
import { BRAIN_HOST_REFUSAL, type BrainHostRefusal } from "./bounds.js";

export {
  claimRuntimeSession,
  conversationReachableBy,
  runtimeSessionReachableBy,
} from "@luke/database/models/recorded-session";

/**
 * The host's own check of who a session is for. eve authenticates a request
 * and pins the caller who created a session as its initiator, but it knows
 * nothing of conversations: who reaches a conversation is a fact of the
 * store, and the host enforces it here, before every tool call and every
 * write. A session is admitted for a conversation only when the conversation
 * the session was opened for exists, is not cleared, and the current caller
 * reaches it: the account that opened it, or a member of the workspace whose
 * task or coding agent it is (`recorded-session.ts`). A member speaks into
 * the session a teammate opened, so account B, a stranger to A's workspace,
 * can neither speak into A's session nor be shown A's rows through it, while
 * a teammate of A's can. The admission names both accounts: the caller, who
 * gates every read, is metered, and binds the tools, and the conversation's
 * owner, the opener, whose id addresses its rows. A conversation runs in one eve session at a time, the
 * one its row records: a session that is not the recorded one — one the
 * conversation rotated away from, whose hooks may still be firing — is
 * refused too, so two sessions never write one conversation. The record is
 * claimed by the session's own start, and only forward: eve's session ids
 * sort by the instant they were minted, so a start replayed for an older
 * session finds a newer one recorded and claims nothing.
 */

export interface AdmittedConversation {
  /** The account the current request acts for: it reads, pays, and acts through the tools. */
  readonly caller: string;
  /** The conversation as the store addresses it, under the account that opened it. */
  readonly target: ConversationTarget;
  /** The eve session id the conversation row last recorded, where one has been. */
  readonly runtimeSessionId: string | undefined;
  /** The time zone the current request named, which the turn reads the developer's day in; none reads UTC. */
  readonly timeZone: string | undefined;
}

/** The conversation the session was admitted to, or the one word for why it was not. */
export type ConversationAdmission = Result.Result<AdmittedConversation, BrainHostRefusal>;

/** How a read here fails: the driver's own refusal, or a row the schema refused. */
type ConversationFailure = QueryError | Schema.SchemaError;

/**
 * How a session stands to the conversation's record: it must be the recorded
 * session, it is the one claiming the record now, or it is a subagent's child
 * session, which no record names. A child is admitted on reach alone where
 * eve tells a resolver nothing of its lineage; the current-session check for
 * it stands where its tools run, through the root eve does name there
 * (`conversationSessionOf`).
 */
export const SESSION_STANDING = {
  CURRENT: "current",
  CLAIMING: "claiming",
  DELEGATED: "delegated",
} as const;

type SessionStanding = (typeof SESSION_STANDING)[keyof typeof SESSION_STANDING];

const ConversationRowSchema = Schema.Struct({
  userId: Schema.String,
  runtimeSessionId: Schema.NullOr(Schema.String),
});

const findConversation = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: ConversationRowSchema,
  execute: (conversationId) =>
    Database.use((db) =>
      db
        .select({
          userId: conversations.userId,
          runtimeSessionId: conversations.runtimeSessionId,
        })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), isNull(conversations.deletedAt))),
    ),
});

/**
 * Whether the account reaches the conversation whose row the admission read:
 * through the workspace of the task or agent that names it, or, for one no
 * work names, as its opener (`conversationReachableBy`).
 */
function reaches(
  account: string,
  conversationId: string,
): Effect.Effect<boolean, ConversationFailure, DatabaseServices> {
  return conversationReachableBy(account, conversationId);
}

export function admitConversation(
  auth: SessionAuth,
  session: { readonly id: string; readonly standing: SessionStanding },
): Effect.Effect<ConversationAdmission, ConversationFailure, DatabaseServices> {
  const current = auth.current;
  const account = actedForAccount(current);
  if (!current || account === undefined) {
    return Effect.succeed(Result.fail(BRAIN_HOST_REFUSAL.NO_PRINCIPAL));
  }
  const initiator = auth.initiator ?? current;
  const conversationId = conversationIdOf(initiator);
  if (!conversationId) return Effect.succeed(Result.fail(BRAIN_HOST_REFUSAL.NO_CONVERSATION));
  return Effect.gen(function* () {
    const found = yield* findConversation(conversationId);
    if (Option.isNone(found)) return Result.fail(BRAIN_HOST_REFUSAL.NO_CONVERSATION);
    const row = found.value;
    // Note that a caller who does not reach the conversation is refused for the seat it took:
    // in a session another account opened, or in one it opened itself over another's row.
    if (!(yield* reaches(account, conversationId))) {
      return Result.fail(
        actedForAccount(initiator) === account
          ? BRAIN_HOST_REFUSAL.NOT_OWNER
          : BRAIN_HOST_REFUSAL.NOT_INITIATOR,
      );
    }
    if (session.standing === SESSION_STANDING.CURRENT && row.runtimeSessionId !== session.id) {
      return Result.fail(BRAIN_HOST_REFUSAL.NOT_CURRENT_SESSION);
    }
    return Result.succeed({
      caller: account,
      target: { userId: row.userId, conversationId },
      runtimeSessionId: row.runtimeSessionId ?? undefined,
      timeZone: timeZoneOf(current),
    });
  });
}

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
