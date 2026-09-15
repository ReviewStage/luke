import { Effect, type Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { ConversationTarget } from "../store/index.js";
import type { BrainHostTurn } from "./bounds.js";
import { EVE_SEND_OUTCOME, type EveSessions } from "./eve-sessions.js";
import { claimRuntimeSession, recordedRuntimeSession } from "./recorded-session.js";

/**
 * The one way the deployment hands a conversation a turn of the host's own:
 * sent to the eve session the conversation's row records, or opened in a new
 * session where none is recorded or eve has retired the recorded one. The
 * scheduled opener and the child completion both hand over this way, so the
 * two agree on what a retired session means and neither reopens on a
 * refusal eve meant. A session eve opened is claimed for the row at once,
 * forward-only, the same claim its own start makes so the two agree
 * whichever lands first; a caller whose handovers may race for one
 * conversation holds the conversation's row lock around the call, as an
 * ask's dispatch does, so the second reads the session the first opened.
 */

export interface HandoverSeams<Turn extends BrainHostTurn> {
  readonly eve: EveSessions<Turn>;
  readonly now: () => number;
  /** Where a refusal is said; a handover never throws into its caller's pass. */
  readonly report: (message: string) => void;
}

/** Whether eve took the message: sent to the session the conversation runs in, or opened in a new one where none runs. */
export const handToEve = /* @__PURE__ */ Effect.fn("handToEve")(function* <
  Turn extends BrainHostTurn,
>(
  seams: HandoverSeams<Turn>,
  target: ConversationTarget,
  turn: Turn,
  words: string,
): Effect.fn.Return<boolean, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const message = { conversationId: target.conversationId, turn, message: words };
  const recorded = yield* recordedRuntimeSession(target);
  if (recorded !== undefined) {
    const sent = yield* Effect.promise(() => seams.eve.send(recorded, message));
    if (sent.outcome === EVE_SEND_OUTCOME.ACCEPTED) return true;
    if (sent.outcome === EVE_SEND_OUTCOME.FAILED) {
      seams.report(
        `eve refused a ${turn} turn on conversation ${target.conversationId} with status ${sent.status}.`,
      );
      return false;
    }
  }
  const opened = yield* Effect.promise(() => seams.eve.open(message));
  if (opened.outcome === EVE_SEND_OUTCOME.ACCEPTED) {
    yield* claimRuntimeSession(target, opened.sessionId, new Date(seams.now()));
    return true;
  }
  seams.report(
    `eve refused to open a session for conversation ${target.conversationId} with status ${opened.status}.`,
  );
  return false;
});
