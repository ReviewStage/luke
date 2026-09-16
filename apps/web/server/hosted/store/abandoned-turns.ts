import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  sessionKey,
  TURN_STATUS,
} from "../../core.js";
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
 * emit later finds the row terminal and is repeated, not written.
 */

export const TURN_ABANDON = {
  /**
   * How long a turn may stand running before the sweep settles it. Far past
   * any deadline a turn runs under: a scheduled turn has its account's
   * 25-second share of the tick, and eve's own step retries end well inside
   * the hour, so a row still running this long is one whose end is not
   * coming.
   */
  AFTER_MS: 60 * 60 * 1000,
  /** The most turns one tick settles; the rest wait for the next minute. */
  LIMIT: 50,
} as const;

const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

const AbandonedTurnRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  conversationId: Schema.String,
}).pipe(Schema.encodeKeys({ userId: "user_id", conversationId: "conversation_id" }));

/** The running turns started before the instant, longest running first, of conversations still standing; a cleared conversation's turns go with its purge. */
const abandonedTurns = SqlSchema.findAll({
  Request: Schema.Struct({ startedBefore: Schema.Date, limit: Schema.Int }),
  Result: AbandonedTurnRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select turns.id, turns.user_id, turns.conversation_id
        from turns
        join conversations on conversations.id = turns.conversation_id
        where turns.status = ${TURN_STATUS.RUNNING}
          and turns.started_at < ${request.startedBefore}
          and conversations.deleted_at is null
        order by turns.started_at asc, turns.id asc
        limit ${request.limit}
      `,
    ),
});

export interface AbandonedTurnSweepStore {
  readonly writer: Pick<StoreWriter, "consume">;
}

export interface AbandonedTurnSweepOptions {
  readonly now: number;
  /** The most turns the sweep settles; `TURN_ABANDON.LIMIT` otherwise. */
  readonly limit?: number | undefined;
}

/** Settles every running turn started more than the bound ago as failed for abandonment; answers how many it settled. */
export const sweepAbandonedTurns = /* @__PURE__ */ Effect.fn("sweepAbandonedTurns")(function* (
  store: AbandonedTurnSweepStore,
  options: AbandonedTurnSweepOptions,
): Effect.fn.Return<number, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const turns = yield* abandonedTurns({
    startedBefore: new Date(options.now - TURN_ABANDON.AFTER_MS),
    limit: options.limit ?? TURN_ABANDON.LIMIT,
  });
  let settled = 0;
  for (const turn of turns) {
    // The end stands alone in the turn's sequence: the relay's count of what it told is not known here, and the writer settles the row by the turn's id.
    const written = yield* store.writer.consume(
      { userId: turn.userId, conversationId: turn.conversationId },
      {
        kind: BRAIN_RUN_EVENT.TURN_ENDED,
        conversationId: sessionKey(turn.conversationId),
        turnId: turn.id,
        sequence: 1,
        status: BRAIN_REQUEST_STATUS.FAILED,
        failure: BRAIN_REQUEST_FAILURE.ABANDONED,
        responseIds: [],
        at: options.now,
      },
    );
    if (written.ok && written.effect === STORE_WRITE_EFFECT.WRITTEN) settled += 1;
  }
  return settled;
});
