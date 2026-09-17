/**
 * stop-carrier.ts -- the Stop a waiting ask took, carried to eve at the start of its turn.
 */

import { Effect, type Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { ConversationTarget, StoreWriter } from "../store/index.js";
import { describeUnreachable, EVE_CANCEL_OUTCOME, type EveSessions } from "./eve-sessions.js";

/** What carrying a waiting ask's Stop at its turn's start needs: eve as the carrier reaches it, the writer's stamp, the clock, and where a refusal is said. */
export interface StopCarrierSeams {
  readonly eve: Pick<EveSessions, "cancel">;
  readonly writer: Pick<StoreWriter, "requestTurnCancel">;
  readonly now: () => number;
  readonly report: (message: string) => void;
}

/**
 * eve's cancel of the turn, scoped to it, and then the row's stamp. The row is
 * stamped only for a cancel eve took: a stamp standing over a turn eve was
 * never asked to stop would read to the route's Stop as already carried, and
 * the developer's own Stop under their bearer would then ask eve nothing. A
 * refused cancel leaves the ask's stamp standing for the route's Stop to
 * carry, and says so.
 *
 * eve's cancel is a request over the network, an effect of the client's own;
 * an eve that could not be reached is said and leaves the stamp standing, the
 * same as a refused cancel, and the stamp below is the same store effect every
 * other write here is, on the fiber the event arrived on.
 */
export const carryStop = /* @__PURE__ */ Effect.fn("carryStop")(function* (
  seams: StopCarrierSeams,
  target: ConversationTarget,
  sessionId: string,
  eveTurnId: string,
  turnId: string,
): Effect.fn.Return<void, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const cancelled = yield* seams.eve.cancel(sessionId, eveTurnId).pipe(
    Effect.catchTag("EveUnreachable", (failure) => {
      seams.report(
        `The Stop on turn ${eveTurnId} of session ${sessionId} did not reach eve: ${describeUnreachable(failure)}.`,
      );
      return Effect.succeed(undefined);
    }),
  );
  if (cancelled === undefined) return;
  if (cancelled.outcome === EVE_CANCEL_OUTCOME.FAILED) {
    seams.report(
      `The Stop on turn ${eveTurnId} of session ${sessionId} was refused by eve (${cancelled.status}).`,
    );
    return;
  }
  yield* seams.writer.requestTurnCancel(target, { turnId, at: new Date(seams.now()) });
});
