import { BRAIN_REQUEST_FAILURE, BRAIN_REQUEST_STATUS, BRAIN_RUN_EVENT } from "@luke/features/brain";
import { sessionKey } from "@luke/runtime/vocabulary";
import { TURN_STATUS } from "@luke/wire";
import { and, asc, eq, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { conversations, turns } from "../schemas/storage.js";
import { CONVERSATION_KIND } from "../storage-vocabulary.js";
import { STORE_WRITE_EFFECT, type StoreWriter } from "./writer.js";

/**
 * The sweep over turns whose end was never heard. A turn moves to running
 * when eve's start reaches the relay and settles when its end does; a run
 * whose end the relay never saw — eve's workflow lost, a hook that failed
 * on the boundary and was never retried, a deployment gone between the two
 * — leaves its row running and its journal open for good, and every reader
 * of the turn shows a run still going. The sweep settles such a turn as
 * failed for abandonment once it has run past the bound, through the same
 * write the relay's own end takes, so its journal is finished and its
 * unanswered parts are settled exactly as a failed turn's are. Relay state
 * is irrelevant here: eve emitted no end the relay saw, and an end eve does
 * emit later finds the row terminal and is repeated, not written. A coding
 * agent's turn whose session eve says it no longer runs is settled on the
 * same write at once, failed for its session's end rather than abandoned
 * (`settleEndedSessionTurn`), since eve's word is final where the sweep's
 * bound is only a guess. A turn a Stop was asked of is settled sooner, and
 * as cancelled: eve confirms a cancel within seconds by ending the turn, so
 * a Stop still unconfirmed past its bound is one whose session is gone, as
 * a session that died in a deploy is, and the turn ends as the Stop asked
 * rather than standing running until the abandonment bound.
 */

export const TURN_ABANDON = {
  /**
   * How long a turn may stand running before the sweep settles it. Far past
   * any deadline a turn runs under: eve's own step retries end well inside
   * the hour, so a row still running this long is one whose end is not
   * coming.
   */
  AFTER_MS: 60 * 60 * 1000,
  /**
   * How long a coding agent's turn may stand running before the sweep
   * settles it. A coding agent's one turn is its whole run, and its sandbox
   * lives up to the platform's day (`coder-host/bounds.ts`'s
   * `SANDBOX_TIMEOUT_MS`), so an hour would fail an agent still at work and
   * leave its Stop with nothing to stop; the day and an hour's grace past
   * it is a run whose end is not coming.
   */
  CODING_AGENT_AFTER_MS: 25 * 60 * 60 * 1000,
  /**
   * How long a turn may stand running after a Stop was asked of it before
   * the sweep settles it as cancelled. eve's own cancel ends the turn within
   * seconds, so a Stop still unconfirmed this long found no session to
   * stop, whatever eve answered it.
   */
  CANCEL_AFTER_MS: 5 * 60 * 1000,
  /** The most turns one sweep settles; the rest wait for the next minute. */
  LIMIT: 50,
} as const;

const LostTurnSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  conversationId: Schema.String,
});

const AbandonedTurnRowSchema = Schema.Struct({
  ...LostTurnSchema.fields,
  cancelRequestedAt: Schema.NullOr(Schema.Date),
});

/** The running turns started before the instant of their conversation's kind, or whose Stop was asked before its own instant, longest running first, of conversations still standing; a cleared conversation's turns go with its purge. */
const abandonedTurns = SqlSchema.findAll({
  Request: Schema.Struct({
    startedBefore: Schema.Date,
    codingAgentStartedBefore: Schema.Date,
    cancelRequestedBefore: Schema.Date,
    limit: Schema.Int,
  }),
  Result: AbandonedTurnRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select({
          id: turns.id,
          userId: turns.userId,
          conversationId: turns.conversationId,
          cancelRequestedAt: turns.cancelRequestedAt,
        })
        .from(turns)
        .innerJoin(conversations, eq(conversations.id, turns.conversationId))
        .where(
          and(
            eq(turns.status, TURN_STATUS.RUNNING),
            isNull(conversations.deletedAt),
            or(
              and(
                ne(conversations.kind, CONVERSATION_KIND.CODING_AGENT),
                lt(turns.startedAt, request.startedBefore),
              ),
              and(
                eq(conversations.kind, CONVERSATION_KIND.CODING_AGENT),
                lt(turns.startedAt, request.codingAgentStartedBefore),
              ),
              and(
                isNotNull(turns.cancelRequestedAt),
                lt(turns.cancelRequestedAt, request.cancelRequestedBefore),
              ),
            ),
          ),
        )
        .orderBy(asc(turns.startedAt), asc(turns.id))
        .limit(request.limit),
    ),
});

/** A turn whose end is not coming: its id, and the conversation and account it stands in. */
export type LostTurn = typeof LostTurnSchema.Type;

/** How a lost turn ends: cancelled where its Stop went unconfirmed, failed for the reason given otherwise. */
type LostTurnEnd =
  | { readonly status: typeof BRAIN_REQUEST_STATUS.CANCELLED }
  | {
      readonly status: typeof BRAIN_REQUEST_STATUS.FAILED;
      readonly failure:
        | typeof BRAIN_REQUEST_FAILURE.ABANDONED
        | typeof BRAIN_REQUEST_FAILURE.SESSION_ENDED;
    };

/**
 * The turn settled as the end given, through the write the
 * relay's own end takes; whether this write settled it, a turn already
 * ended being a repeat. The end stands alone in the turn's sequence: the
 * relay's count of what it told is not known here, and the writer settles
 * the row by the turn's id.
 */
const settledLost = (
  writer: Pick<StoreWriter, "consume">,
  turn: LostTurn,
  end: LostTurnEnd,
  now: number,
) =>
  Effect.map(
    writer.consume(
      { userId: turn.userId, conversationId: turn.conversationId },
      {
        kind: BRAIN_RUN_EVENT.TURN_ENDED,
        conversationId: sessionKey(turn.conversationId),
        turnId: turn.id,
        sequence: 1,
        ...end,
        responseIds: [],
        at: now,
      },
    ),
    (written) => Result.isSuccess(written) && written.success === STORE_WRITE_EFFECT.WRITTEN,
  );

export interface AbandonedTurnSweepStore {
  readonly writer: Pick<StoreWriter, "consume">;
}

export interface AbandonedTurnSweepOptions {
  readonly now: number;
  /** The most turns the sweep settles; `TURN_ABANDON.LIMIT` otherwise. */
  readonly limit?: number | undefined;
}

/** Settles every running turn whose Stop went unconfirmed past its bound as cancelled, and every other one started more than its kind's bound ago as failed for abandonment; answers how many it settled. */
export const sweepAbandonedTurns = /* @__PURE__ */ Effect.fn("web/sweepAbandonedTurns")(function* (
  store: AbandonedTurnSweepStore,
  options: AbandonedTurnSweepOptions,
): Effect.fn.Return<number, QueryError | Schema.SchemaError, DatabaseServices> {
  const turns = yield* abandonedTurns({
    startedBefore: new Date(options.now - TURN_ABANDON.AFTER_MS),
    codingAgentStartedBefore: new Date(options.now - TURN_ABANDON.CODING_AGENT_AFTER_MS),
    cancelRequestedBefore: new Date(options.now - TURN_ABANDON.CANCEL_AFTER_MS),
    limit: options.limit ?? TURN_ABANDON.LIMIT,
  });
  let settled = 0;
  const cancelRequestedBefore = options.now - TURN_ABANDON.CANCEL_AFTER_MS;
  for (const { cancelRequestedAt, ...turn } of turns) {
    // Note that a Stop past its bound wins over abandonment, because the turn ends as the developer asked.
    const cancelled =
      cancelRequestedAt !== null && cancelRequestedAt.getTime() < cancelRequestedBefore;
    const written = yield* settledLost(
      store.writer,
      turn,
      cancelled
        ? { status: BRAIN_REQUEST_STATUS.CANCELLED }
        : { status: BRAIN_REQUEST_STATUS.FAILED, failure: BRAIN_REQUEST_FAILURE.ABANDONED },
      options.now,
    );
    if (written) settled += 1;
  }
  return settled;
});

/**
 * Settles the coding agent's turn named as failed because its session ended
 * for good, as eve answered a message to it, at `now`; answers whether this
 * call settled it. Only the turn named is settled, and only while it still
 * stands queued or running, so a turn that ended meanwhile keeps its own end
 * and a newer turn is never touched.
 */
export const settleEndedSessionTurn = /* @__PURE__ */ Effect.fn("web/settleEndedSessionTurn")(
  function* (
    writer: Pick<StoreWriter, "consume">,
    turn: LostTurn,
    now: number,
  ): Effect.fn.Return<boolean, QueryError | Schema.SchemaError, DatabaseServices> {
    return yield* settledLost(
      writer,
      turn,
      { status: BRAIN_REQUEST_STATUS.FAILED, failure: BRAIN_REQUEST_FAILURE.SESSION_ENDED },
      now,
    );
  },
);
