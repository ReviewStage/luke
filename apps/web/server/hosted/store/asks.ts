import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Option, type ParseResult, Schema } from "effect";
import { ASK_ORIGIN, type AskOrigin } from "../../core.js";
import { recordedRuntimeSession } from "../brain-host/recorded-session.js";
import type { HostedStoreRun } from "./database.js";
import type { ConversationTarget } from "./writer.js";

/**
 * The ask record: one row per ask from its accept to its turn, written and
 * read as effects over the store's one SQL client and answered to a caller
 * through the runner it composed. An ask is recorded once per conversation
 * and client id, by the unique index rather than by a read first, so two
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
  readonly question: string;
  readonly createdAt: Date;
}

interface AskDispatch {
  readonly sessionId: string;
  readonly deliveryId?: string;
  readonly turnId?: string;
}

/** The one answer a dispatch gives besides the row: the conversation it would run in no longer stands, a Clear having landed between the ask's admission and the dispatch's lock. */
export const ASK_DISPATCH_REFUSAL = {
  NO_CONVERSATION: "no_conversation",
} as const;

type AskDispatchRefusal = (typeof ASK_DISPATCH_REFUSAL)[keyof typeof ASK_DISPATCH_REFUSAL];

/** The ask record as the routes and the voice function read and write it. */
export interface AskRecord {
  /** Records the ask once per conversation and client id; answers the row standing, this call's or an earlier one's. */
  record(ask: AskWrite): Promise<AskRow>;
  /** The ask the id names, where the account holds it. */
  named(userId: string, id: string): Promise<AskRow | undefined>;
  /** The newest eve session any of the conversation's asks was handed to, by eve's own sortable ids, ahead of the conversation row recording it. */
  latestSession(userId: string, conversationId: string): Promise<string | undefined>;
  /**
   * Runs the dispatch under the conversation's lock unless a session is already written, handing it
   * the conversation's newest session as read under that lock, and writes what eve answered; answers
   * the row after, or `NO_CONVERSATION` when the conversation no longer stands, so a Clear landing
   * between the ask's admission and its dispatch is the caller's refusal and not a failure.
   */
  dispatchOnce(
    target: ConversationTarget,
    id: string,
    dispatch: (sessionId: string | undefined) => Promise<AskDispatch | undefined>,
  ): Promise<AskRow | AskDispatchRefusal>;
  /** Stamps a Stop on an ask whose turn has not started, for the start to honour. */
  cancelRequested(id: string, at: Date): Promise<void>;
}

/** The binding the relay makes when eve's `turn.started` names the deliveries a turn carries. */
export interface AskDeliveryBinding {
  /** Names the turn each delivered ask of the conversation ran in; answers the asks bound, with any Stop stamped on them. */
  bindDeliveries(
    target: ConversationTarget,
    deliveryIds: readonly string[],
    turnId: string,
  ): Promise<readonly AskRow[]>;
  /**
   * The conversation's asks bound to the turn that carry a Stop: the ask that opened the session is
   * bound at its dispatch with no delivery, and a follow-up's stamp may land after its binding, so the
   * start reads every ask of the turn rather than only the rows it just bound.
   */
  stoppedOn(target: ConversationTarget, turnId: string): Promise<readonly AskRow[]>;
}

type AskFailure = SqlError | ParseResult.ParseError;

const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

const AskRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("user_id")),
  conversationId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("conversation_id")),
  clientId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("client_id")),
  origin: Schema.Literal(...Object.values(ASK_ORIGIN)),
  createdAt: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("created_at")),
  sessionId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("session_id"),
  ),
  deliveryId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("delivery_id"),
  ),
  turnId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(Schema.fromKey("turn_id")),
  cancelRequestedAt: Schema.propertySignature(Schema.NullOr(Schema.DateFromSelf)).pipe(
    Schema.fromKey("cancel_requested_at"),
  ),
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
  origin: Schema.Literal(...Object.values(ASK_ORIGIN)),
  question: Schema.String,
  createdAt: Schema.DateFromSelf,
});

/** The insert lands or finds the client id already standing in the conversation; either way the row is read back by that pair. */
const insertAsk = SqlSchema.void({
  Request: AskWriteSchema,
  execute: (ask) =>
    statement(
      (sql) => sql`
        insert into asks (user_id, conversation_id, client_id, origin, question, created_at)
        values (${ask.userId}, ${ask.conversationId}, ${ask.clientId}, ${ask.origin}, ${ask.question}, ${ask.createdAt})
        on conflict (conversation_id, client_id) do nothing
      `,
    ),
});

const AskByClientSchema = Schema.Struct({ conversationId: Schema.String, clientId: Schema.String });

const findAskByClient = SqlSchema.findOne({
  Request: AskByClientSchema,
  Result: AskRowSchema,
  execute: (key) =>
    statement(
      (sql) => sql`
        select id, user_id, conversation_id, client_id, origin, created_at,
               session_id, delivery_id, turn_id, cancel_requested_at
        from asks
        where conversation_id = ${key.conversationId} and client_id = ${key.clientId}
      `,
    ),
});

const AskByIdSchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

const findAskById = SqlSchema.findOne({
  Request: AskByIdSchema,
  Result: AskRowSchema,
  execute: (key) =>
    statement(
      (sql) => sql`
        select id, user_id, conversation_id, client_id, origin, created_at,
               session_id, delivery_id, turn_id, cancel_requested_at
        from asks
        where id = ${key.id} and user_id = ${key.userId}
      `,
    ),
});

const LatestSessionSchema = Schema.Struct({ userId: Schema.String, conversationId: Schema.String });

const SessionRowSchema = Schema.Struct({
  sessionId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("session_id")),
});

const findLatestSession = SqlSchema.findOne({
  Request: LatestSessionSchema,
  Result: SessionRowSchema,
  execute: (key) =>
    statement(
      (sql) => sql`
        select session_id from asks
        where user_id = ${key.userId}
          and conversation_id = ${key.conversationId}
          and session_id is not null
        order by session_id desc
        limit 1
      `,
    ),
});

/** The newest session any of the conversation's asks was handed to, by eve's sortable ids. */
function latestSessionOf(
  target: ConversationTarget,
): Effect.Effect<string | undefined, AskFailure, SqlClient.SqlClient> {
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

/** The dispatch writes what it learned and keeps what an earlier one learned: a delivery or a turn already named is never blanked. */
const markDispatched = SqlSchema.void({
  Request: DispatchSchema,
  execute: (dispatch) =>
    statement(
      (sql) => sql`
        update asks
        set session_id = ${dispatch.sessionId},
            delivery_id = coalesce(${dispatch.deliveryId}, delivery_id),
            turn_id = coalesce(${dispatch.turnId}::uuid, turn_id)
        where id = ${dispatch.id}
      `,
    ),
});

const CancelSchema = Schema.Struct({ id: Schema.String, at: Schema.DateFromSelf });

/** The first Stop stands; a second leaves the first instant in place. */
const markCancelRequested = SqlSchema.void({
  Request: CancelSchema,
  execute: (cancel) =>
    statement(
      (sql) => sql`
        update asks set cancel_requested_at = ${cancel.at}
        where id = ${cancel.id} and cancel_requested_at is null
      `,
    ),
});

const BindSchema = Schema.Struct({
  userId: Schema.String,
  conversationId: Schema.String,
  deliveryIds: Schema.Array(Schema.String),
  turnId: Schema.String,
});

const StoppedOnSchema = Schema.Struct({
  userId: Schema.String,
  conversationId: Schema.String,
  turnId: Schema.String,
});

const findStoppedOn = SqlSchema.findAll({
  Request: StoppedOnSchema,
  Result: AskRowSchema,
  execute: (key) =>
    statement(
      (sql) => sql`
        select * from asks
        where user_id = ${key.userId}
          and conversation_id = ${key.conversationId}
          and turn_id = ${key.turnId}
          and cancel_requested_at is not null
        order by id
      `,
    ),
});

/** Only an ask not yet bound takes the turn: a start eve emits again names the same deliveries and changes nothing. */
const bindDeliveredAsks = SqlSchema.findAll({
  Request: BindSchema,
  Result: AskRowSchema,
  execute: (bind) =>
    statement(
      (sql) => sql`
        update asks set turn_id = ${bind.turnId}::uuid
        where user_id = ${bind.userId}
          and conversation_id = ${bind.conversationId}
          and delivery_id in ${sql.in(bind.deliveryIds)}
          and turn_id is null
        returning id, user_id, conversation_id, client_id, origin, created_at,
                  session_id, delivery_id, turn_id, cancel_requested_at
      `,
    ),
});

const ConversationLockSchema = Schema.Struct({
  userId: Schema.String,
  conversationId: Schema.String,
});

/** The conversation row under its own lock, the lock the writer and Clear take, so one dispatch at a time runs in a conversation. */
const lockConversation = SqlSchema.findOne({
  Request: ConversationLockSchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (target) =>
    statement(
      (sql) => sql`
        select id from conversations
        where id = ${target.conversationId} and user_id = ${target.userId} and deleted_at is null
        for update
      `,
    ),
});

/** The ask's row, read inside the conversation's lock. */
const readAsk = SqlSchema.findOne({
  Request: Schema.String,
  Result: AskRowSchema,
  execute: (id) =>
    statement(
      (sql) => sql`
        select id, user_id, conversation_id, client_id, origin, created_at,
               session_id, delivery_id, turn_id, cancel_requested_at
        from asks
        where id = ${id}
      `,
    ),
});

/**
 * One dispatch at a time per conversation: the conversation row is locked,
 * the ask row is read under it, a session already written ends the call
 * with nothing dispatched, and otherwise the caller's dispatch runs under
 * the lock and what eve answered is written before it is released. The lock
 * is the conversation's rather than the ask's on purpose: two first asks of
 * different client ids on a conversation with no session would each open
 * one, and the ask bound to the session the forward-only claim loses would
 * never read a turn; under the conversation's lock the second waits, reads
 * the session the first opened, and sends into it. A dispatch that answers
 * nothing leaves the row as it was, for a retry. The order is the one every
 * lock here keeps: the user's row, then the conversation's, and never an
 * ask's row held while a conversation's is wanted.
 */
function dispatchAskOnce(
  target: ConversationTarget,
  id: string,
  dispatch: (sessionId: string | undefined) => Promise<AskDispatch | undefined>,
): Effect.Effect<AskRow | AskDispatchRefusal, AskFailure, SqlClient.SqlClient> {
  return Effect.flatMap(SqlClient.SqlClient, (sql) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockConversation(target);
        if (Option.isNone(locked)) return ASK_DISPATCH_REFUSAL.NO_CONVERSATION;
        const read = yield* readAsk(id);
        if (Option.isNone(read)) throw new Error("the ask to dispatch is not standing");
        const standing = askRow(read.value);
        if (standing.sessionId !== undefined) return standing;
        const session = newestSession(
          yield* recordedRuntimeSession(target),
          yield* latestSessionOf(target),
        );
        const answered = yield* Effect.promise(() => dispatch(session));
        if (answered === undefined) return standing;
        yield* markDispatched({
          id,
          sessionId: answered.sessionId,
          deliveryId: answered.deliveryId ?? null,
          turnId: answered.turnId ?? null,
        });
        return { ...standing, ...answered };
      }),
    ),
  );
}

/** The one place a client id becomes a row: the insert lands or is refused by the index, and the row is read back either way. */
function recordAsk(ask: AskWrite): Effect.Effect<AskRow, AskFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    yield* insertAsk(ask);
    const row = yield* findAskByClient({
      conversationId: ask.conversationId,
      clientId: ask.clientId,
    });
    if (Option.isNone(row)) throw new Error("the ask's row is not standing after its insert");
    return askRow(row.value);
  });
}

/** The record over the runner the caller composed: the same runner the store and the writers stand on. */
export function askRecord(run: HostedStoreRun): AskRecord & AskDeliveryBinding {
  return {
    record: (ask) => run(recordAsk(ask)),
    named: (userId, id) =>
      run(
        Effect.map(findAskById({ userId, id }), (found) =>
          Option.getOrUndefined(Option.map(found, askRow)),
        ),
      ),
    latestSession: (userId, conversationId) => run(latestSessionOf({ userId, conversationId })),
    dispatchOnce: (target, id, dispatch) => run(dispatchAskOnce(target, id, dispatch)),
    cancelRequested: (id, at) => run(markCancelRequested({ id, at })),
    bindDeliveries: (target, deliveryIds, turnId) =>
      deliveryIds.length === 0
        ? Promise.resolve([])
        : run(
            Effect.map(
              bindDeliveredAsks({ ...target, deliveryIds: [...deliveryIds], turnId }),
              (rows) => rows.map(askRow),
            ),
          ),
    stoppedOn: (target, turnId) =>
      run(Effect.map(findStoppedOn({ ...target, turnId }), (rows) => rows.map(askRow))),
  };
}
