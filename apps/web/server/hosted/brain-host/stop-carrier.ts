import type { Promised } from "../fiber-runner.js";
import type { ConversationTarget, StoreWriter } from "../store/index.js";
import { EVE_CANCEL_OUTCOME, type EveSessions } from "./eve-sessions.js";

/** What carrying a waiting ask's Stop at its turn's start needs: eve as the carrier reaches it, the writer's stamp, the clock, and where a refusal is said. */
export interface StopCarrierSeams {
  readonly eve: Pick<EveSessions, "cancel">;
  readonly writer: Promised<Pick<StoreWriter, "requestTurnCancel">>;
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
 */
export async function carryStop(
  seams: StopCarrierSeams,
  target: ConversationTarget,
  sessionId: string,
  eveTurnId: string,
  turnId: string,
): Promise<void> {
  const cancelled = await seams.eve.cancel(sessionId, eveTurnId);
  if (cancelled.outcome === EVE_CANCEL_OUTCOME.FAILED) {
    seams.report(
      `The Stop on turn ${eveTurnId} of session ${sessionId} was refused by eve (${cancelled.status}).`,
    );
    return;
  }
  await seams.writer.requestTurnCancel(target, { turnId, at: new Date(seams.now()) });
}
