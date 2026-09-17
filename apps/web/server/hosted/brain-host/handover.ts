/**
 * handover.ts -- the one send-else-open the deployment hands a conversation a turn through.
 *
 * The one way the deployment hands a conversation a turn of the host's own:
 * sent to the eve session the conversation's row records, or opened in a new
 * session where none is recorded or eve has retired the recorded one. The
 * scheduled opener and the child completion both hand over this way, so the
 * two agree on what a retired session means and neither reopens on a
 * refusal eve meant. The send holds no row lock: eve's follow-up is an HTTP
 * call with its own not-active retries behind it, up to two seconds, and
 * the conversation's row is the one an ask's dispatch locks too. Whether
 * the open takes that lock is the caller's word: a caller whose handovers
 * may race for one conversation, as two children of one parent ending
 * together do, opens under it in a transaction of its own, since each
 * would otherwise open a session and the one the forward-only claim lost
 * would run a turn nothing reads; under the lock the second waits, reads
 * the session the first claimed, and sends into it once the lock is let
 * go. The scheduled opener, one visit an account a tick, opens without it.
 * A session eve opened is claimed for the row at once, forward-only, the
 * same claim its own start makes so the two agree whichever lands first.
 */

import { Clock, Effect, type Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { ConversationTarget } from "../store/index.js";
import type { BrainHostTurn } from "./bounds.js";
import {
  describeUnreachable,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
  type EveUnreachable,
} from "./eve-sessions.js";
import {
  claimRuntimeSession,
  lockConversationRow,
  recordedRuntimeSession,
} from "./recorded-session.js";

export interface HandoverSeams<Turn extends BrainHostTurn> {
  readonly eve: EveSessions<Turn>;
  /** Where a refusal is said; a handover never throws into its caller's pass. */
  readonly report: (message: string) => void;
}

/** Whether the open branch takes the conversation's row lock, as the module comment describes. */
export const SESSION_OPENING = {
  /** Under the row lock, for handovers that may race for one conversation. */
  LOCKED: "locked",
  /** Without it, for a caller that is alone in opening the conversation's session. */
  UNLOCKED: "unlocked",
} as const;

export type SessionOpening = (typeof SESSION_OPENING)[keyof typeof SESSION_OPENING];

/**
 * How many opens under the lock one handover makes before it gives the turn
 * up: each is entered with the session eve last retired, so a session
 * another handover recorded meanwhile and eve retired before this turn
 * reached it is opened past on the next, rather than the turn lost to it.
 */
const OPEN_ATTEMPTS = 2;

/** What the open under the lock came to. */
const OPENING = {
  /** eve opened a session and the row records it: the turn is under way. */
  OPENED: "opened",
  /** Another handover recorded a session while this one waited; the send follows into it. */
  RECORDED: "recorded",
  /** Nothing opened, said: the conversation no longer stands, or eve refused. */
  NOTHING: "nothing",
} as const;

type Opening =
  | { readonly outcome: typeof OPENING.OPENED }
  | { readonly outcome: typeof OPENING.RECORDED; readonly sessionId: string }
  | { readonly outcome: typeof OPENING.NOTHING };

type SendOutcome = (typeof EVE_SEND_OUTCOME)[keyof typeof EVE_SEND_OUTCOME];

/** An eve that could not be reached, said with what the client knows of it; the turn is not handed over. */
function unreachable(seams: { readonly report: (message: string) => void }, what: string) {
  return (failure: EveUnreachable) => {
    seams.report(`eve could not be reached for ${what}: ${describeUnreachable(failure)}.`);
    return Effect.succeed(undefined);
  };
}

/** eve's answer to the message sent into the session, a refusal said here and a retirement left to the caller. */
const sendInto = /* @__PURE__ */ Effect.fn("web/sendInto")(function* <Turn extends BrainHostTurn>(
  seams: HandoverSeams<Turn>,
  sessionId: string,
  message: EveMessage<Turn>,
): Effect.fn.Return<SendOutcome> {
  const sent = yield* seams.eve
    .send(sessionId, message)
    .pipe(
      Effect.catchTag(
        "EveUnreachable",
        unreachable(seams, `a ${message.turn} turn on conversation ${message.conversationId}`),
      ),
    );
  if (sent === undefined) return EVE_SEND_OUTCOME.FAILED;
  if (sent.outcome === EVE_SEND_OUTCOME.FAILED) {
    seams.report(
      `eve refused a ${message.turn} turn on conversation ${message.conversationId} with status ${sent.status}.`,
    );
  }
  return sent.outcome;
});

/** A new session opened for the conversation, and claimed for its row; a refusal said. */
const openSession = /* @__PURE__ */ Effect.fn("web/openSession")(function* <
  Turn extends BrainHostTurn,
>(
  seams: HandoverSeams<Turn>,
  target: ConversationTarget,
  message: EveMessage<Turn>,
): Effect.fn.Return<Opening, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const opened = yield* seams.eve
    .open(message)
    .pipe(
      Effect.catchTag(
        "EveUnreachable",
        unreachable(seams, `a session for conversation ${target.conversationId}`),
      ),
    );
  if (opened === undefined) return { outcome: OPENING.NOTHING };
  if (opened.outcome === EVE_SEND_OUTCOME.ACCEPTED) {
    yield* claimRuntimeSession(target, opened.sessionId, new Date(yield* Clock.currentTimeMillis));
    return { outcome: OPENING.OPENED };
  }
  seams.report(
    `eve refused to open a session for conversation ${target.conversationId} with status ${opened.status}.`,
  );
  return { outcome: OPENING.NOTHING };
});

/**
 * The open under the conversation's row lock: the row's session is read
 * again there, since a handover that waited on the lock finds the session
 * the one ahead of it opened, and only a row still recording no session, or
 * still the one eve retired, has a new one opened for it.
 */
const openUnderLock = /* @__PURE__ */ Effect.fn("web/openUnderLock")(function* <
  Turn extends BrainHostTurn,
>(
  seams: HandoverSeams<Turn>,
  target: ConversationTarget,
  message: EveMessage<Turn>,
  retired: string | undefined,
): Effect.fn.Return<Opening, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      if (!(yield* lockConversationRow(target))) {
        seams.report(
          `A ${message.turn} turn for conversation ${target.conversationId} was not handed over: the conversation no longer stands.`,
        );
        return { outcome: OPENING.NOTHING };
      }
      const recorded = yield* recordedRuntimeSession(target);
      if (recorded !== undefined && recorded !== retired) {
        return { outcome: OPENING.RECORDED, sessionId: recorded };
      }
      return yield* openSession(seams, target, message);
    }),
  );
});

/** Whether eve took the message: sent to the session the conversation runs in, or opened in a new one where none runs. */
export const handToEve = /* @__PURE__ */ Effect.fn("web/handToEve")(function* <
  Turn extends BrainHostTurn,
>(
  seams: HandoverSeams<Turn>,
  target: ConversationTarget,
  turn: Turn,
  words: string,
  opening: SessionOpening,
): Effect.fn.Return<boolean, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const message = { conversationId: target.conversationId, turn, message: words };
  let recorded = yield* recordedRuntimeSession(target);
  if (recorded !== undefined) {
    const sent = yield* sendInto(seams, recorded, message);
    if (sent !== EVE_SEND_OUTCOME.RETIRED) return sent === EVE_SEND_OUTCOME.ACCEPTED;
  }
  for (let attempt = 0; attempt < OPEN_ATTEMPTS; attempt += 1) {
    const opened = yield* opening === SESSION_OPENING.LOCKED
      ? openUnderLock(seams, target, message, recorded)
      : openSession(seams, target, message);
    if (opened.outcome !== OPENING.RECORDED) return opened.outcome === OPENING.OPENED;
    // The session another handover opened is sent into once the lock is let go; one eve has
    // retired before this turn reached it is what the next open is entered with.
    const sent = yield* sendInto(seams, opened.sessionId, message);
    if (sent !== EVE_SEND_OUTCOME.RETIRED) return sent === EVE_SEND_OUTCOME.ACCEPTED;
    recorded = opened.sessionId;
  }
  seams.report(
    `eve retired every session recorded for conversation ${target.conversationId} before a ${turn} turn reached it.`,
  );
  return false;
});
