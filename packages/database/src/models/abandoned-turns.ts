import { RUN_EVENT, RUN_STATUS, TURN_FAILURE } from "@repo/features/turn-run";
import { sessionKey } from "@repo/runtime/vocabulary";
import { TURN_STATUS } from "@repo/wire";
import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { conversations, turns } from "../schemas/storage.js";
import { CONVERSATION_KIND } from "../storage-vocabulary.js";
import { dropNativeProjectionTurns } from "./native-projection-store.js";
import { TURN_LEASE } from "./turn-lease.js";
import { STORE_WRITE_EFFECT, type StoreWriter } from "./writer.js";

/**
 * abandoned-turns.ts -- the turns whose end is not coming, settled through the write the runner's own end takes.
 *
 * A turn moves to running when its runner opens it and settles when its
 * runner's end lands; a runner gone without its end (its sandbox stopped, its
 * Mac asleep or gone, a post refused for good) leaves the row running and its
 * journal open. Nothing sweeps for that: the turn's lease
 * (`./turn-lease.ts`) runs out once the runner stops posting, every reader
 * takes it as lost from then, and the next touch of the agent reads the
 * lapsed turns here (`lapsedTurnIds`) and settles them failed as a runner
 * lost (`settleRunnerLostTurns`), or canceled where a Stop was asked of them.
 * A coding agent's turn whose session the runtime says no longer runs is
 * settled on the same write at once, failed for its session's end
 * (`settleEndedSessionTurn`, `settleEndedSession`). Each settle goes through
 * the store writer's own end, so its journal is finished and its unanswered
 * parts settled exactly as a failed turn's are, and an end that lands later
 * finds the row terminal and is repeated, not written.
 */

export const LOST_TURNS = {
  /**
   * How long a turn may stand open after a Stop was asked of it before it is
   * read as lapsed whatever its lease: a runner ends a turn within seconds of
   * its Stop, and the Stop's own force ends it ten seconds on, so one still
   * open this long has a runner that heard neither, even one still beating.
   */
  STOP_CONFIRM_MS: 5 * 60 * 1000,
  /** The most turns one read of an ended session takes; reads go on until none is left. */
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
  startedAt: Schema.NullOr(Schema.Date),
});

/** What every read of turns to settle selects: a lost turn, when a Stop was asked of it, and when it started. */
const ABANDONED_TURN_COLUMNS = {
  id: turns.id,
  userId: turns.userId,
  conversationId: turns.conversationId,
  cancelRequestedAt: turns.cancelRequestedAt,
  startedAt: turns.startedAt,
};

/** A turn joined to the conversation it stands in. */
const TURN_CONVERSATION = eq(conversations.id, turns.conversationId);

/**
 * The ids of the conversation's turns still queued or running whose lease
 * ran out before the instant, oldest first. Note that a turn with no lease,
 * which a writer from before the lease may still queue while a deploy rolls
 * out, is read as though its lease ran from its queueing, because a runner
 * still posting gives it one at its next post (`turn-lease.ts`); and a turn
 * whose Stop went unconfirmed past `LOST_TURNS.STOP_CONFIRM_MS` is read as
 * lapsed whatever its lease, since a runner that heard neither the Stop nor
 * its force may beat on for good.
 */
const findLapsedTurns = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    before: Schema.Date,
    queuedBefore: Schema.Date,
    stoppedBefore: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ id: turns.id })
        .from(turns)
        .where(
          and(
            eq(turns.conversationId, request.conversationId),
            inArray(turns.status, [TURN_STATUS.QUEUED, TURN_STATUS.RUNNING]),
            or(
              lt(turns.leaseUntil, request.before),
              and(isNull(turns.leaseUntil), lt(turns.queuedAt, request.queuedBefore)),
              lt(turns.cancelRequestedAt, request.stoppedBefore),
            ),
          ),
        )
        .orderBy(asc(turns.queuedAt), asc(turns.id)),
    ),
});

/** A turn whose end is not coming: its id, and the conversation and account it stands in. */
export type LostTurn = typeof LostTurnSchema.Type;

/**
 * The turns still queued or running of the standing coding agent's
 * conversation that records the runtime session, oldest first, each with
 * when a Stop was asked of it. A
 * conversation that has since recorded a newer session no longer names this
 * one, so its turns, which are the newer session's, are never read here.
 */
const endedSessionTurns = SqlSchema.findAll({
  Request: Schema.Struct({ runtimeSessionId: Schema.String, limit: Schema.Int }),
  Result: AbandonedTurnRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select(ABANDONED_TURN_COLUMNS)
        .from(turns)
        .innerJoin(conversations, TURN_CONVERSATION)
        .where(
          and(
            eq(conversations.runtimeSessionId, request.runtimeSessionId),
            eq(conversations.kind, CONVERSATION_KIND.AGENT),
            isNull(conversations.deletedAt),
            inArray(turns.status, [TURN_STATUS.QUEUED, TURN_STATUS.RUNNING]),
          ),
        )
        .orderBy(asc(turns.queuedAt), asc(turns.id))
        .limit(request.limit),
    ),
});

/** How a lost turn ends: canceled where its Stop went unconfirmed, failed for the reason given otherwise. */
type LostTurnEnd =
  | { readonly status: typeof RUN_STATUS.CANCELED }
  | {
      readonly status: typeof RUN_STATUS.FAILED;
      readonly failure: typeof TURN_FAILURE.SESSION_ENDED;
      readonly failureDetail?: string;
    }
  | {
      readonly status: typeof RUN_STATUS.FAILED;
      readonly failure: typeof TURN_FAILURE.MODEL;
      readonly failureDetail: string;
    };

/** What a native agent's turn whose runner went away says it failed of, as a runner's own failed end says why; a caller that knows how the runner ended appends that after it. */
export const RUNNER_LOST_DETAIL = "the agent's runner stopped before its turn ended";

/** The turns still queued or running of the standing coding agent's conversation named, oldest first. */
const agentRunningTurns = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String }),
  Result: AbandonedTurnRowSchema,
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db
        .select(ABANDONED_TURN_COLUMNS)
        .from(turns)
        .innerJoin(conversations, TURN_CONVERSATION)
        .where(
          and(
            eq(turns.conversationId, conversationId),
            eq(conversations.kind, CONVERSATION_KIND.AGENT),
            isNull(conversations.deletedAt),
            inArray(turns.status, [TURN_STATUS.QUEUED, TURN_STATUS.RUNNING]),
          ),
        )
        .orderBy(asc(turns.queuedAt), asc(turns.id)),
    ),
});

/**
 * The turn settled as the end given, through the write the
 * relay's own end takes; whether this write settled it, a turn already
 * ended being a repeat. The end stands alone in the turn's sequence: the
 * relay's count of what it told is not known here, and the writer settles
 * the row by the turn's id. A write the writer refused is logged by its
 * word, since the turn it leaves running would otherwise say nothing of why.
 */
const settledLost = (
  writer: Pick<StoreWriter, "consume">,
  turn: LostTurn,
  end: LostTurnEnd,
  now: number,
) =>
  Effect.gen(function* () {
    const written = yield* writer.consume(
      { userId: turn.userId, conversationId: turn.conversationId },
      {
        kind: RUN_EVENT.TURN_ENDED,
        conversationId: sessionKey(turn.conversationId),
        turnId: turn.id,
        sequence: 1,
        ...end,
        responseIds: [],
        at: now,
      },
    );
    if (Result.isFailure(written)) {
      yield* Effect.logWarning(`a lost turn's settle was refused: ${written.failure.refusal}`).pipe(
        Effect.annotateLogs({ conversationId: turn.conversationId, turnId: turn.id }),
      );
      return false;
    }
    return written.success === STORE_WRITE_EFFECT.WRITTEN;
  });

/** The ids of the conversation's turns still queued or running whose lease ran out before `now`, oldest first: the turns whose runner is lost, for a settle of just those (`settleRunnerLostTurns`'s `only`). */
export function lapsedTurnIds(
  conversationId: string,
  now: number,
): Effect.Effect<readonly string[], QueryError | Schema.SchemaError, DatabaseServices> {
  const lapsed = {
    conversationId,
    before: new Date(now),
    queuedBefore: new Date(now - TURN_LEASE.MS),
    stoppedBefore: new Date(now - LOST_TURNS.STOP_CONFIRM_MS),
  };
  return Effect.map(findLapsedTurns(lapsed), (rows) => rows.map((row) => row.id));
}

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
      { status: RUN_STATUS.FAILED, failure: TURN_FAILURE.SESSION_ENDED },
      now,
    );
  },
);

export interface EndedSessionOptions {
  readonly now: number;
  /** Why eve said the session failed, redacted and bounded, kept on each turn failed for it; nothing for a session that only expired. */
  readonly failureDetail?: string | undefined;
  /** The most turns one read takes; `LOST_TURNS.LIMIT` otherwise. Reads go on until none is left. */
  readonly limit?: number | undefined;
}

/**
 * Settles every turn still queued or running of the coding agent's
 * conversation that records the runtime session eve said ended; answers how
 * many this call settled. A turn a Stop was asked of is settled canceled,
 * as the developer asked and as the sweep would settle it, and every other
 * one failed for its session's end, keeping why eve said it failed where it
 * said, and logged with its ids. A session no standing coding agent's
 * conversation records, such as an unknown one or one its conversation
 * rotated away from, settles nothing. Each turn is settled through the
 * relay's own end, so a turn that ended between the read and the write
 * keeps its own end and a repeat of the same end settles nothing again.
 * The turns are read a bounded batch at a time until a batch comes back
 * short: a turn that ended meanwhile, by this call or another writer, drops
 * out of the next read. A batch holding only turns already read, which a
 * write the writer refused leaves open, ends the reads too, so they never
 * go round for ever.
 */
export const settleEndedSession = /* @__PURE__ */ Effect.fn("web/settleEndedSession")(function* (
  writer: Pick<StoreWriter, "consume">,
  runtimeSessionId: string,
  options: EndedSessionOptions,
): Effect.fn.Return<number, QueryError | Schema.SchemaError, DatabaseServices> {
  const limit = options.limit ?? LOST_TURNS.LIMIT;
  let settled = 0;
  const read = new Set<string>();
  for (;;) {
    const lost = yield* endedSessionTurns({ runtimeSessionId, limit });
    if (lost.every((turn) => read.has(turn.id))) return settled;
    for (const { cancelRequestedAt, startedAt: _startedAt, ...turn } of lost) {
      read.add(turn.id);
      const { failureDetail } = options;
      const written = yield* settledLost(
        writer,
        turn,
        cancelRequestedAt === null
          ? {
              status: RUN_STATUS.FAILED,
              failure: TURN_FAILURE.SESSION_ENDED,
              ...(failureDetail !== undefined ? { failureDetail } : undefined),
            }
          : { status: RUN_STATUS.CANCELED },
        options.now,
      );
      if (!written) continue;
      settled += 1;
      if (cancelRequestedAt !== null) continue;
      yield* Effect.logError(
        `a turn was settled failed for its session's end: ${failureDetail ?? "the session expired"}`,
      ).pipe(
        Effect.annotateLogs({
          conversationId: turn.conversationId,
          turnId: turn.id,
          failure: TURN_FAILURE.SESSION_ENDED,
        }),
      );
    }
    if (lost.length < limit) return settled;
  }
});

/**
 * Settles every turn still queued or running of the native coding agent's
 * conversation as failed, its runner gone with no end told, as a runner's
 * own failed end settles one, or as canceled where a Stop was asked of it, so the agent reads failed and offers Continue
 * rather than running for a day; answers the ids of the turns this call
 * settled as failed, so a caller logs and reports those and no canceled
 * one or one the writer refused. The
 * turn the native projection holds is dropped with them, so the next
 * launch's events open a turn of their own rather than one already ended.
 * A launch that failed before its runner ran names why in `detail`. Where
 * `only` is given, just the turns it names are settled, so a caller that
 * read which turns were lost at one instant (`runningTurnIds`) leaves alone
 * a turn begun since. Where the runner can never be reached again, as for
 * an agent its device will not start, the turns fail as a session that
 * ended (`failure`), which leaves nothing awaiting a turn and offers only a
 * new agent.
 */
export const settleRunnerLostTurns = /* @__PURE__ */ Effect.fn("web/settleRunnerLostTurns")(
  function* (
    writer: Pick<StoreWriter, "consume">,
    conversationId: string,
    now: number,
    detail: string = RUNNER_LOST_DETAIL,
    only?: ReadonlySet<string>,
    failure: typeof TURN_FAILURE.MODEL | typeof TURN_FAILURE.SESSION_ENDED = TURN_FAILURE.MODEL,
  ): Effect.fn.Return<readonly string[], QueryError | Schema.SchemaError, DatabaseServices> {
    const running = yield* agentRunningTurns({ conversationId });
    const lost = only === undefined ? running : running.filter((turn) => only.has(turn.id));
    const failed: string[] = [];
    for (const { cancelRequestedAt, ...turn } of lost) {
      const written = yield* settledLost(
        writer,
        turn,
        cancelRequestedAt === null
          ? { status: RUN_STATUS.FAILED, failure, failureDetail: detail }
          : { status: RUN_STATUS.CANCELED },
        now,
      );
      if (written && cancelRequestedAt === null) failed.push(turn.id);
    }
    yield* dropNativeProjectionTurns(
      conversationId,
      lost.map((turn) => turn.id),
    );
    return failed;
  },
);

/** The ids of the turns still queued or running of the coding agent's conversation named, for a later settle of just those (`settleRunnerLostTurns`'s `only`). */
export function runningTurnIds(
  conversationId: string,
): Effect.Effect<readonly string[], QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(agentRunningTurns({ conversationId }), (rows) => rows.map((row) => row.id));
}
