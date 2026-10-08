import { randomUUID } from "node:crypto";
import {
  closeGracefully,
  type LiveSideband,
  SIDEBAND_CLOSE_OUTCOME,
  type SidebandCloseResult,
} from "@sidecar/voice/live-session";
import { Deferred, Effect, Exit, type Scope, Stream } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { LIVE_SERVER_EVENT } from "../live.js";
import type { VoiceAccounts } from "./accounts.js";
import { upstreamSideband } from "./live-sideband.js";
import type { LiveUpstream } from "./openai.js";
import type { DetachedVoiceSession, VoiceSessionRecord } from "./session-record.js";

/**
 * The bound on a detached voice session. A sessions-route connection whose
 * device socket went without a hang-up leaves the WebRTC session standing
 * for the device's re-attach and stamps the row detached; a device that does
 * not come back within the grace leaves a session running on Luke's key with
 * no connection to end it, since nothing else will send `session.close`. The
 * scheduled sweep ends each one the way a connection would: it attaches a
 * fresh sideband through the same upstream, sends `session.close` through the
 * same graceful close the exchange runs, and on `session.closed` writes the
 * close and the seconds exactly as the service does, the seconds once
 * through the ledger. A session OpenAI will not attach to is already gone,
 * and one that never answers the close is let go of; both are closed as a
 * lost connection with the last unconfirmed snapshot standing, so no row is
 * swept twice.
 *
 * Each sweep takes at most `MAX_SESSIONS` of the oldest, `CONCURRENCY` at a
 * time, each bounded by the attach's own wait and the close's, so the sweep
 * takes at most two rounds of both out of the function's duration.
 */

/** How long a detached session waits for its device before the sweep ends it: past the Mac's own re-attach of some ten seconds. */
export const VOICE_DETACH_GRACE_MS = 60_000;

export const VOICE_ORPHAN_SWEEP = {
  MAX_SESSIONS: 20,
  CONCURRENCY: 10,
  /** How long the fresh sideband is given to stand, which the sweep's upstream is built with. */
  ATTACH_TIMEOUT_MS: 5_000,
  /** How long `session.closed` is waited on once `session.close` went up. */
  CLOSE_TIMEOUT_MS: 5_000,
} as const;

/** How one orphan ended: its own `session.closed` read and its seconds recorded, or let go of as a lost connection. */
const ORPHAN_ENDING = {
  CLOSED: "closed",
  LOST: "lost",
} as const;

type OrphanEnding = (typeof ORPHAN_ENDING)[keyof typeof ORPHAN_ENDING];

/** What one sweep came to: sessions closed with their seconds, sessions closed as lost, and sessions whose write failed and stand for the next sweep. */
export interface VoiceOrphanSweepOutcome {
  closed: number;
  lost: number;
  failed: number;
}

export const NOTHING_ORPHANED: VoiceOrphanSweepOutcome = { closed: 0, lost: 0, failed: 0 };

export interface VoiceOrphanSweepSeams {
  /** Luke's own upstream, the one the voice functions attach through. */
  readonly upstream: LiveUpstream;
  readonly record: VoiceSessionRecord;
  /** The seconds ledger the service records a closed session through. */
  readonly recordSeconds: VoiceAccounts["recordSeconds"];
}

/** The sideband's last word handed to the graceful close: its `session.closed`, or the socket's close before one. */
function readLastWord(
  sideband: LiveSideband,
  settled: Deferred.Deferred<SidebandCloseResult>,
): Effect.Effect<void> {
  return Stream.runForEach(sideband.arrivals, (arrival) => {
    if ("close" in arrival) {
      return Effect.asVoid(
        Deferred.succeed(settled, {
          outcome: SIDEBAND_CLOSE_OUTCOME.CONNECTION_LOST,
          close: arrival.close,
        }),
      );
    }
    if (arrival.event.type !== LIVE_SERVER_EVENT.SESSION_CLOSED) return Effect.void;
    return Effect.asVoid(
      Deferred.succeed(settled, { outcome: SIDEBAND_CLOSE_OUTCOME.CLOSED, closed: arrival.event }),
    );
  });
}

/** One orphan ended through a sideband of its own, written down as a connection that read the same ending would. */
const endOrphan = /* @__PURE__ */ Effect.fn("web/endOrphan")(function* (
  seams: VoiceOrphanSweepSeams,
  orphan: DetachedVoiceSession,
): Effect.fn.Return<OrphanEnding, unknown, SqlClient.SqlClient | Scope.Scope> {
  const { sessionId, userId } = orphan;
  const attached = yield* Effect.exit(seams.upstream.attach(sessionId));
  if (Exit.isFailure(attached)) {
    yield* seams.record.closeLost({ sessionId });
    return ORPHAN_ENDING.LOST;
  }
  const socket = attached.value;
  const sideband = yield* upstreamSideband(socket);
  const settled = yield* Deferred.make<SidebandCloseResult>();
  yield* Effect.forkScoped(readLastWord(sideband, settled));
  // Resumed once the reader stands, as the service resumes a sideband: the
  // upstream answers it paused so nothing is said to no one.
  yield* Effect.sync(() => socket.resume());
  const ended = yield* closeGracefully(sideband, {
    eventId: randomUUID(),
    settled: Deferred.await(settled),
    timeoutMs: VOICE_ORPHAN_SWEEP.CLOSE_TIMEOUT_MS,
  });
  if (ended.outcome !== SIDEBAND_CLOSE_OUTCOME.CLOSED) {
    yield* seams.record.closeLost({ sessionId });
    return ORPHAN_ENDING.LOST;
  }
  const seconds = ended.closed.usage.seconds;
  yield* seams.record.close({ sessionId, seconds, reason: ended.closed.reason });
  yield* seams.recordSeconds({ userId, sessionId, seconds });
  return ORPHAN_ENDING.CLOSED;
});

/** Ends every session detached longer ago than the grace, oldest first and bounded, and counts how each ended. */
export const sweepVoiceOrphans = /* @__PURE__ */ Effect.fn("web/sweepVoiceOrphans")(function* (
  seams: VoiceOrphanSweepSeams,
  options: { readonly now: number },
): Effect.fn.Return<VoiceOrphanSweepOutcome, unknown, SqlClient.SqlClient> {
  const orphans = yield* seams.record.detached({
    detachedBefore: options.now - VOICE_DETACH_GRACE_MS,
    limit: VOICE_ORPHAN_SWEEP.MAX_SESSIONS,
  });
  const endings = yield* Effect.forEach(
    orphans,
    (orphan) => Effect.exit(Effect.scoped(endOrphan(seams, orphan))),
    { concurrency: VOICE_ORPHAN_SWEEP.CONCURRENCY },
  );
  const outcome = { ...NOTHING_ORPHANED };
  for (const ending of endings) {
    if (Exit.isFailure(ending)) outcome.failed += 1;
    else if (ending.value === ORPHAN_ENDING.CLOSED) outcome.closed += 1;
    else outcome.lost += 1;
  }
  return outcome;
});
