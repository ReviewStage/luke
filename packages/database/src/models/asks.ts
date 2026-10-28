import { ASK_ORIGIN, type AskOrigin } from "@luke/features";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { Effect, Exit, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { asks, conversations } from "../schemas/storage.js";
import { InstantColumnSchema } from "./columns.js";
import {
  DispatchClaimHeld,
  dispatchClaimStands,
  recordedWithinExpiry,
  releaseDispatchClaim,
  takeDispatchClaim,
  waitingOutDispatchClaim,
} from "./dispatch-claim.js";
import { recordedRuntimeSession } from "./recorded-session.js";
import type { ConversationTarget } from "./writer.js";

/**
 * The ask record: one row per ask from its accept to its turn, written and
 * read as effects over the store's one SQL client and answered to its caller
 * as effects too. An ask is recorded once per conversation and client id, by
 * the unique index rather than by a read first, so two
 * arrivals of one client id leave one row and both callers read it. What
 * eve accepted is written onto the row as it is learned: the session at
 * dispatch, the delivery a follow-up was named, and the turn once
 * `turn.started` names that delivery, which is the one place a delivery id
 * is turned into a turn id. Every read is scoped to the account that asked.
 */

/** One ask as its record holds it. */
export interface AskRow {
  readonly id: string;
  readonly userId: string;
  readonly conversationId: string;
  readonly clientId: string;
  readonly origin: AskOrigin;
  readonly createdAt: Date;
  /** The eve session the ask was handed to, once eve accepted it. */
  readonly sessionId?: string;
  /** The delivery eve named for a follow-up; an ask that opened its session has none, its turn is the session's first. */
  readonly deliveryId?: string;
  /** The turn the ask ran in, as the store keys it, once known. */
  readonly turnId?: string;
  readonly cancelRequestedAt?: Date;
}

interface AskWrite {
  readonly userId: string;
  readonly conversationId: string;
  readonly clientId: string;
  readonly origin: AskOrigin;
  readonly createdAt: Date;
}

interface AskDispatch {
  readonly sessionId: string;
  readonly deliveryId?: string;
  readonly turnId?: string;
}

/**
 * The answers a dispatch gives besides the row: the conversation it would run
 * in no longer stands, a deletion having landed between the ask's admission
 * and the dispatch's claim; or another hand-over's claim stood on the
 * conversation for as long as the dispatch waits for it, and nothing was
 * handed over.
 */
export const ASK_DISPATCH_REFUSAL = {
  NO_CONVERSATION: "no_conversation",
  BUSY: "busy",
} as const;

type AskDispatchRefusal = (typeof ASK_DISPATCH_REFUSAL)[keyof typeof ASK_DISPATCH_REFUSAL];

/** The ask record as the routes read and write it. */
export interface AskRecord {
  /** Records the ask once per conversation and client id; answers the row standing, this call's or an earlier one's. */
  record(ask: AskWrite): AskEffect<AskRow>;
  /** The ask the id names, where the account holds it. */
  named(userId: string, id: string): AskEffect<AskRow | undefined>;
  /** The newest eve session any of the conversation's asks was handed to, by eve's own sortable ids, ahead of the conversation row recording it. */
  latestSession(userId: string, conversationId: string): AskEffect<string | undefined>;
  /**
   * Runs the dispatch under the conversation's dispatch claim unless a session is already written, handing
   * it the conversation's newest session as read as the claim is taken, and writes what eve answered;
   * answers the row after, `NO_CONVERSATION` when the conversation no longer stands, so a deletion
   * landing between the ask's admission and its dispatch is the caller's refusal and not a failure, or
   * `BUSY` where another hand-over's claim outlasted the wait for it.
   */
  dispatchOnce(
    target: ConversationTarget,
    id: string,
    dispatch: (sessionId: string | undefined) => Effect.Effect<AskDispatch | undefined>,
  ): AskEffect<AskRow | AskDispatchRefusal>;
  /** Stamps a Stop on an ask whose turn has not started, for the start to honour. */
  cancelRequested(id: string, at: Date): AskEffect<void>;
}

/** What every method of the record answers: an effect over the ambient client. */
type AskEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** The whole of an ask's row, as every read of one projects it and the binding returns it. */
const ASK_COLUMNS = {
  id: asks.id,
  userId: asks.userId,
  conversationId: asks.conversationId,
  clientId: asks.clientId,
  origin: asks.origin,
  createdAt: asks.createdAt,
  sessionId: asks.sessionId,
  deliveryId: asks.deliveryId,
  turnId: asks.turnId,
  cancelRequestedAt: asks.cancelRequestedAt,
} as const;

const AskRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  conversationId: Schema.String,
  clientId: Schema.String,
  origin: Schema.Literals(Object.values(ASK_ORIGIN)),
  createdAt: InstantColumnSchema,
  sessionId: Schema.NullOr(Schema.String),
  deliveryId: Schema.NullOr(Schema.String),
  turnId: Schema.NullOr(Schema.String),
  cancelRequestedAt: Schema.NullOr(InstantColumnSchema),
});

type AskRowRead = Schema.Schema.Type<typeof AskRowSchema>;

/** The row as the record answers it: a column that is null is a field that is absent. */
function askRow(read: AskRowRead): AskRow {
  return {
    id: read.id,
    userId: read.userId,
    conversationId: read.conversationId,
    clientId: read.clientId,
    origin: read.origin,
    createdAt: read.createdAt,
    ...(read.sessionId !== null ? { sessionId: read.sessionId } : undefined),
    ...(read.deliveryId !== null ? { deliveryId: read.deliveryId } : undefined),
    ...(read.turnId !== null ? { turnId: read.turnId } : undefined),
    ...(read.cancelRequestedAt !== null
      ? { cancelRequestedAt: read.cancelRequestedAt }
      : undefined),
  };
}

const AskWriteSchema = Schema.Struct({
  userId: Schema.String,
  conversationId: Schema.String,
  clientId: Schema.String,
  origin: Schema.Literals(Object.values(ASK_ORIGIN)),
  createdAt: Schema.Date,
});

/** The insert lands or finds the client id already standing in the conversation; either way the row is read back by that pair. */
const insertAsk = SqlSchema.void({
  Request: AskWriteSchema,
  execute: (ask) =>
    Database.use((db) =>
      db
        .insert(asks)
        .values({
          userId: ask.userId,
          conversationId: ask.conversationId,
          clientId: ask.clientId,
          origin: ask.origin,
          createdAt: ask.createdAt,
        })
        .onConflictDoNothing({ target: [asks.conversationId, asks.clientId] }),
    ),
});

const AskByClientSchema = Schema.Struct({ conversationId: Schema.String, clientId: Schema.String });

const findAskByClient = SqlSchema.findOneOption({
  Request: AskByClientSchema,
  Result: AskRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(ASK_COLUMNS)
        .from(asks)
        .where(and(eq(asks.conversationId, key.conversationId), eq(asks.clientId, key.clientId))),
    ),
});

const AskByIdSchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

const findAskById = SqlSchema.findOneOption({
  Request: AskByIdSchema,
  Result: AskRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(ASK_COLUMNS)
        .from(asks)
        .where(and(eq(asks.id, key.id), eq(asks.userId, key.userId))),
    ),
});

const LatestSessionSchema = Schema.Struct({ userId: Schema.String, conversationId: Schema.String });

const SessionRowSchema = Schema.Struct({ sessionId: Schema.String });

const findLatestSession = SqlSchema.findOneOption({
  Request: LatestSessionSchema,
  Result: SessionRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ sessionId: asks.sessionId })
        .from(asks)
        .where(
          and(
            eq(asks.userId, key.userId),
            eq(asks.conversationId, key.conversationId),
            isNotNull(asks.sessionId),
          ),
        )
        .orderBy(desc(asks.sessionId))
        .limit(1),
    ),
});

/** The newest session any of the conversation's asks was handed to, by eve's sortable ids. */
function latestSessionOf(
  target: ConversationTarget,
): Effect.Effect<string | undefined, StoreFailure, DatabaseServices> {
  return Effect.map(findLatestSession(target), (found) =>
    Option.getOrUndefined(Option.map(found, (row) => row.sessionId)),
  );
}

/**
 * The session a follow-up goes to: the newest the account's record knows of,
 * whether the conversation row has recorded it yet or only the ask that
 * opened it has. eve's session ids sort by the instant they were minted,
 * the same ordering the row's forward-only claim relies on, so the greater
 * id is the newer session; a row still recording a session the last ask
 * moved on from would otherwise be sent to, retried against, and reopened
 * beside.
 */
export function newestSession(
  recorded: string | undefined,
  latestDispatched: string | undefined,
): string | undefined {
  if (recorded === undefined) return latestDispatched;
  if (latestDispatched === undefined) return recorded;
  return latestDispatched > recorded ? latestDispatched : recorded;
}

const DispatchSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  deliveryId: Schema.NullOr(Schema.String),
  turnId: Schema.NullOr(Schema.String),
});

/**
 * The dispatch writes what it learned and keeps what an earlier one learned:
 * a delivery or a turn already named is never blanked. The builder has no
 * spelling for keeping what stands, so each is a fragment over the column
 * beside the value the dispatch carried; the turn's is cast because a
 * parameter that may be null decides no type of its own beside a `uuid`.
 */
const markDispatched = SqlSchema.void({
  Request: DispatchSchema,
  execute: (dispatch) =>
    Database.use((db) =>
      db
        .update(asks)
        .set({
          sessionId: dispatch.sessionId,
          deliveryId: sql`coalesce(${dispatch.deliveryId}, ${asks.deliveryId})`,
          turnId: sql`coalesce(${dispatch.turnId}::uuid, ${asks.turnId})`,
          dispatchClaim: null,
        })
        .where(eq(asks.id, dispatch.id)),
    ),
});

const CancelSchema = Schema.Struct({ id: Schema.String, at: Schema.Date });

/** The first Stop stands; a second leaves the first instant in place. */
const markCancelRequested = SqlSchema.void({
  Request: CancelSchema,
  execute: (cancel) =>
    Database.use((db) =>
      db
        .update(asks)
        .set({ cancelRequestedAt: cancel.at })
        .where(and(eq(asks.id, cancel.id), isNull(asks.cancelRequestedAt))),
    ),
});

const ConversationLockSchema = Schema.Struct({
  userId: Schema.String,
  conversationId: Schema.String,
});

/** The conversation row, unless Clear stamped it, read as the dispatch claim is taken. */
const readConversation = SqlSchema.findOneOption({
  Request: ConversationLockSchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (target) =>
    Database.use((db) =>
      db
        .select({ id: conversations.id })
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

/** The ask's row, with the claim it was handed over under, read once the conversation's row is locked. */
const readAsk = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ ...AskRowSchema.fields, dispatchClaim: Schema.NullOr(Schema.String) }),
  execute: (id) =>
    Database.use((db) =>
      db
        .select({ ...ASK_COLUMNS, dispatchClaim: asks.dispatchClaim })
        .from(asks)
        .where(eq(asks.id, id)),
    ),
});

const AskClaimSchema = Schema.Struct({ id: Schema.String, claim: Schema.String });

const markAskClaimed = SqlSchema.void({
  Request: AskClaimSchema,
  execute: ({ id, claim }) =>
    Database.use((db) => db.update(asks).set({ dispatchClaim: claim }).where(eq(asks.id, id))),
});

/** A hand-over that answered nothing leaves the ask as it was, for a retry. */
const clearAskClaim = SqlSchema.void({
  Request: AskClaimSchema,
  execute: ({ id, claim }) =>
    Database.use((db) =>
      db
        .update(asks)
        .set({ dispatchClaim: null })
        .where(and(eq(asks.id, id), eq(asks.dispatchClaim, claim))),
    ),
});

/** What the dispatch came to: the row as it then stands, or the refusal, and what eve answered, where it was handed anything. */
interface AskDispatched {
  readonly row: AskRow | AskDispatchRefusal;
  readonly answered: AskDispatch | undefined;
}

/** Where taking the claim left the dispatch: answered already, or holding the claim with the session to hand the ask to. */
type AskClaimed =
  | { readonly answered: AskRow | AskDispatchRefusal }
  | { readonly standing: AskRow; readonly session: string | undefined; readonly claim: string };

/**
 * The claim taken for the ask's hand-over, in one short transaction: the
 * conversation's row locked, the ask read under it, and the claim written on
 * both. A session already written ends the dispatch with nothing handed
 * over, and so does a claim already on the ask: an earlier hand-over's whose
 * holder died before writing what eve answered, which eve may have taken and
 * is never handed it again (`dispatch-claim.ts`).
 */
const claimAsk = /* @__PURE__ */ Effect.fnUntraced(function* (
  target: ConversationTarget,
  id: string,
  place: number,
): Effect.fn.Return<AskClaimed, StoreFailure | DispatchClaimHeld, DatabaseServices> {
  const standingConversation = yield* readConversation(target);
  if (Option.isNone(standingConversation)) {
    return { answered: ASK_DISPATCH_REFUSAL.NO_CONVERSATION };
  }
  if (yield* dispatchClaimStands(target.conversationId, place)) {
    return yield* new DispatchClaimHeld();
  }
  const read = yield* readAsk(id);
  if (Option.isNone(read)) throw new Error("the ask to dispatch is not standing");
  const standing = askRow(read.value);
  if (standing.sessionId !== undefined) return { answered: standing };
  if (read.value.dispatchClaim !== null) {
    yield* Effect.logWarning("an ask whose hand-over was never recorded is not handed over again", {
      askId: id,
    });
    return { answered: standing };
  }
  const session = newestSession(
    yield* recordedRuntimeSession(target),
    yield* latestSessionOf(target),
  );
  const claim = yield* takeDispatchClaim(target.conversationId, place);
  yield* markAskClaimed({ id, claim });
  return { standing, session, claim };
});

/**
 * What eve answered, written in a second short transaction once the
 * hand-over ended however it ended: the claim released, then the session
 * and delivery written, or, for a hand-over that answered nothing or was
 * interrupted, the ask's claim cleared for a retry; tried again while the
 * claim stands (`recordedWithinExpiry`).
 */
function recordedAsk(
  target: ConversationTarget,
  id: string,
  claim: string,
  answered: AskDispatch | undefined,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    recordedWithinExpiry(
      client.withTransaction(
        Effect.gen(function* () {
          yield* releaseDispatchClaim(target.conversationId, claim);
          if (answered === undefined) return yield* clearAskClaim({ id, claim });
          yield* markDispatched({
            id,
            sessionId: answered.sessionId,
            deliveryId: answered.deliveryId ?? null,
            turnId: answered.turnId ?? null,
          });
        }),
      ),
    ),
  );
}

/**
 * One dispatch at a time per conversation: the conversation's dispatch claim
 * is taken (`dispatch-claim.ts`) with the ask read as it is, a session
 * already written ends the call with nothing dispatched, and otherwise the
 * caller's dispatch runs with no transaction open and what eve answered is
 * written as the claim is released. The claim is the conversation's rather
 * than the ask's on purpose: two first asks of different client ids on a
 * conversation with no session would each open one, and the ask bound to the
 * session the forward-only claim loses would never read a turn; under the
 * conversation's claim the second waits, reads the session the first opened,
 * and sends into it. It is a claim rather than a lock so the journal of the
 * turn under way, and every other write of the conversation, keeps landing
 * while eve answers. A dispatch that answers nothing, or is interrupted, leaves the row as it
 * was, for a retry. The order is the one every lock here keeps: the user's
 * row, then the conversation's row, then an ask's, and never an ask's row
 * held while a conversation's is wanted.
 */
function dispatchAskOnce(
  target: ConversationTarget,
  id: string,
  dispatch: (sessionId: string | undefined) => Effect.Effect<AskDispatch | undefined>,
): Effect.Effect<AskRow | AskDispatchRefusal, StoreFailure, DatabaseServices> {
  const claimed = Effect.flatMap(SqlClient.SqlClient, (client) =>
    waitingOutDispatchClaim(target.conversationId, (place) =>
      client.withTransaction(claimAsk(target, id, place)),
    ).pipe(
      Effect.catchTag("DispatchClaimHeld", () =>
        Effect.succeed<AskClaimed>({ answered: ASK_DISPATCH_REFUSAL.BUSY }),
      ),
    ),
  );
  return Effect.acquireUseRelease(
    claimed,
    (held): Effect.Effect<AskDispatched> =>
      "answered" in held
        ? Effect.succeed({ row: held.answered, answered: undefined })
        : Effect.map(dispatch(held.session), (answered) => ({
            row: answered === undefined ? held.standing : { ...held.standing, ...answered },
            answered,
          })),
    (held, exit) =>
      "answered" in held
        ? Effect.void
        : recordedAsk(
            target,
            id,
            held.claim,
            Exit.isSuccess(exit) ? exit.value.answered : undefined,
          ),
  ).pipe(Effect.map(({ row }) => row));
}

/** The one place a client id becomes a row: the insert lands or is refused by the index, and the row is read back either way. */
const recordAsk = /* @__PURE__ */ Effect.fn("web/recordAsk")(function* (
  ask: AskWrite,
): Effect.fn.Return<AskRow, StoreFailure, DatabaseServices> {
  yield* insertAsk(ask);
  const row = yield* findAskByClient({
    conversationId: ask.conversationId,
    clientId: ask.clientId,
  });
  if (Option.isNone(row)) throw new Error("the ask's row is not standing after its insert");
  return askRow(row.value);
});

/** The record over the ambient client: every method an effect its caller composes into its own request. */
export function askRecord(): AskRecord {
  return {
    record: (ask) => recordAsk(ask),
    named: (userId, id) =>
      Effect.map(findAskById({ userId, id }), (found) =>
        Option.getOrUndefined(Option.map(found, askRow)),
      ),
    latestSession: (userId, conversationId) => latestSessionOf({ userId, conversationId }),
    dispatchOnce: (target, id, dispatch) => dispatchAskOnce(target, id, dispatch),
    cancelRequested: (id, at) => markCancelRequested({ id, at }),
  };
}
