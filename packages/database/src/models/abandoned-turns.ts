import { RUN_EVENT, RUN_STATUS, TURN_FAILURE } from "@repo/features/turn-run";
import { reportUnexpected } from "@repo/runtime/effect";
import { sessionKey } from "@repo/runtime/vocabulary";
import { TURN_STATUS } from "@repo/wire";
import { and, asc, eq, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { conversations, messages, turns } from "../schemas/storage.js";
import { CONVERSATION_KIND } from "../storage-vocabulary.js";
import { dropNativeProjectionTurns } from "./native-projection-store.js";
import { STORE_WRITE_EFFECT, type StoreWriter } from "./writer.js";

export const TURN_ABANDON = {
  AFTER_MS: 60 * 60 * 1000,
  AGENT_AFTER_MS: 25 * 60 * 60 * 1000,
  CANCEL_AFTER_MS: 5 * 60 * 1000,
  LIMIT: 50,
  WITHDRAWN_LINE_LIMIT: 500,
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

const ABANDONED_TURN_COLUMNS = {
  id: turns.id,
  userId: turns.userId,
  conversationId: turns.conversationId,
  cancelRequestedAt: turns.cancelRequestedAt,
  startedAt: turns.startedAt,
};

const TURN_CONVERSATION = eq(conversations.id, turns.conversationId);

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
        .select(ABANDONED_TURN_COLUMNS)
        .from(turns)
        .innerJoin(conversations, TURN_CONVERSATION)
        .where(
          and(
            eq(turns.status, TURN_STATUS.RUNNING),
            isNull(conversations.deletedAt),
            or(
              and(
                ne(conversations.kind, CONVERSATION_KIND.AGENT),
                lt(turns.startedAt, request.startedBefore),
              ),
              and(
                eq(conversations.kind, CONVERSATION_KIND.AGENT),
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

export type LostTurn = typeof LostTurnSchema.Type;

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

type LostTurnEnd =
  | { readonly status: typeof RUN_STATUS.CANCELED }
  | {
      readonly status: typeof RUN_STATUS.FAILED;
      readonly failure: typeof TURN_FAILURE.ABANDONED | typeof TURN_FAILURE.SESSION_ENDED;
      readonly failureDetail?: string;
    }
  | {
      readonly status: typeof RUN_STATUS.FAILED;
      readonly failure: typeof TURN_FAILURE.MODEL;
      readonly failureDetail: string;
    };

export const RUNNER_LOST_DETAIL = "the agent's runner stopped before its turn ended";

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

export interface AbandonedTurnSweepStore {
  readonly writer: Pick<StoreWriter, "consume">;
}

export interface AbandonedTurnSweepOptions {
  readonly now: number;
  readonly limit?: number | undefined;
}

function abandonedSaid(turn: LostTurn, startedAt: Date | null, now: number) {
  const ranMs = startedAt === null ? undefined : now - startedAt.getTime();
  const ids = { conversationId: turn.conversationId, turnId: turn.id };
  return Effect.logError(`a turn ran past its bound with no end heard and was settled abandoned`, {
    ranMs,
  }).pipe(
    Effect.andThen(
      reportUnexpected(TURN_FAILURE.ABANDONED, { ...ids, failure: TURN_FAILURE.ABANDONED, ranMs }),
    ),
    Effect.annotateLogs({ ...ids, failure: TURN_FAILURE.ABANDONED }),
  );
}

export const sweepAbandonedTurns = Effect.fn("web/sweepAbandonedTurns")(function* (
  store: AbandonedTurnSweepStore,
  options: AbandonedTurnSweepOptions,
): Effect.fn.Return<number, QueryError | Schema.SchemaError, DatabaseServices> {
  const turns = yield* abandonedTurns({
    startedBefore: new Date(options.now - TURN_ABANDON.AFTER_MS),
    codingAgentStartedBefore: new Date(options.now - TURN_ABANDON.AGENT_AFTER_MS),
    cancelRequestedBefore: new Date(options.now - TURN_ABANDON.CANCEL_AFTER_MS),
    limit: options.limit ?? TURN_ABANDON.LIMIT,
  });
  let settled = 0;
  const cancelRequestedBefore = options.now - TURN_ABANDON.CANCEL_AFTER_MS;
  for (const { cancelRequestedAt, startedAt, ...turn } of turns) {
    const canceled =
      cancelRequestedAt !== null && cancelRequestedAt.getTime() < cancelRequestedBefore;
    const written = yield* settledLost(
      store.writer,
      turn,
      canceled
        ? { status: RUN_STATUS.CANCELED }
        : { status: RUN_STATUS.FAILED, failure: TURN_FAILURE.ABANDONED },
      options.now,
    );
    if (!written) continue;
    settled += 1;
    if (!canceled) yield* abandonedSaid(turn, startedAt, options.now);
    yield* dropNativeProjectionTurns(turn.conversationId, [turn.id]);
  }
  return settled;
});

export const settleEndedSessionTurn = Effect.fn("web/settleEndedSessionTurn")(function* (
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
});

export interface EndedSessionOptions {
  readonly now: number;
  readonly failureDetail?: string | undefined;
  readonly limit?: number | undefined;
}

export const settleEndedSession = Effect.fn("web/settleEndedSession")(function* (
  writer: Pick<StoreWriter, "consume">,
  runtimeSessionId: string,
  options: EndedSessionOptions,
): Effect.fn.Return<number, QueryError | Schema.SchemaError, DatabaseServices> {
  const limit = options.limit ?? TURN_ABANDON.LIMIT;
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

export const settleRunnerLostTurns = Effect.fn("web/settleRunnerLostTurns")(function* (
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
});

export function runningTurnIds(
  conversationId: string,
): Effect.Effect<readonly string[], QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(agentRunningTurns({ conversationId }), (rows) => rows.map((row) => row.id));
}

const deleteStaleWithdrawnLines = SqlSchema.findAll({
  Request: Schema.Struct({ before: Schema.Date, limit: Schema.Int }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ before, limit }) =>
    Database.use((db) =>
      db
        .delete(messages)
        .where(
          inArray(
            messages.id,
            db
              .select({ id: messages.id })
              .from(messages)
              .where(and(lt(messages.withdrawnAt, before), isNull(messages.turnId)))
              .limit(limit),
          ),
        )
        .returning({ id: messages.id }),
    ),
});

export function purgeWithdrawnLines(
  now: number,
): Effect.Effect<number, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(
    deleteStaleWithdrawnLines({
      before: new Date(now - TURN_ABANDON.AGENT_AFTER_MS),
      limit: TURN_ABANDON.WITHDRAWN_LINE_LIMIT,
    }),
    (rows) => rows.length,
  );
}
