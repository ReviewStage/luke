import { randomUUID } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import {
  closeAvatarSessionsOfEndedCalls,
  closeOpenAvatarSessionsOf,
} from "@luke/database/models/voice-avatar-sessions";
import type {
  DetachedVoiceSession,
  VoiceSessionRecord,
} from "@luke/database/models/voice-session-record";
import { AVATAR_END_REASON, VOICE_CLOSE_REASON } from "@luke/database/voice-vocabulary";
import { LIVE_SERVER_EVENT } from "@luke/live";
import {
  closeGracefully,
  type LiveSideband,
  SIDEBAND_CLOSE_OUTCOME,
  type SidebandCloseResult,
} from "@luke/voice/live-session";
import { Deferred, Effect, Exit, Result, type Scope, Stream } from "effect";
import type { VoiceAccounts } from "./accounts.js";
import { upstreamSideband } from "./live-sideband.js";
import type { LiveUpstream } from "./openai.js";

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
 * through the ledger. A session OpenAI answers the attach for as gone (404
 * or 410) is closed as a lost connection with the last unconfirmed snapshot
 * standing, so no row is swept twice. Anything less conclusive — an attach
 * that timed out, was throttled, or failed at OpenAI, or a close that was
 * never confirmed — says nothing of whether the session still runs, so the
 * row is stamped again and a sweep a grace later tries again, behind the
 * orphans stamped meanwhile, so a few that never answer cannot hold every
 * sweep's bounded batch; only a session past
 * OpenAI's own duration limit, which has ended whatever it answers, is
 * closed as expired instead. Whichever way a voice row is closed here, the
 * avatar rows still open on it close behind it as orphaned, the voice row
 * first so no avatar opens on it after. Every sweep then closes whatever
 * avatar row is still open on a call already closed, as of that call's own
 * close: the repair for a close that landed on the voice row and not behind
 * it, here or in the service.
 *
 * Each sweep takes at most `MAX_SESSIONS` of the oldest, `CONCURRENCY` at a
 * time, each bounded by the attach's own wait and the close's, so the sweep
 * takes at most two rounds of both out of the function's duration.
 */

/** How long a detached session waits for its device before the sweep ends it: past the Mac's own re-attach of some ten seconds. */
export const VOICE_DETACH_GRACE_MS = 60_000;

/** The longest a Live session runs before OpenAI ends it as `expired`: past it, a session that answers nothing is gone. */
export const VOICE_SESSION_LIMIT_MS = 60 * 60_000;

/** The statuses OpenAI refuses an attach with when the session named no longer stands. */
const SESSION_GONE_STATUS: ReadonlySet<number> = new Set([404, 410]);

export const VOICE_ORPHAN_SWEEP = {
  MAX_SESSIONS: 20,
  CONCURRENCY: 10,
  /** How long the fresh sideband is given to stand, which the sweep's upstream is built with. */
  ATTACH_TIMEOUT_MS: 5_000,
  /** How long `session.closed` is waited on once `session.close` went up. */
  CLOSE_TIMEOUT_MS: 5_000,
} as const;

/** How one orphan ended: its own `session.closed` read and its seconds recorded, closed as gone, or left stamped for the next sweep. */
const ORPHAN_ENDING = {
  CLOSED: "closed",
  LOST: "lost",
  PENDING: "pending",
} as const;

type OrphanEnding = (typeof ORPHAN_ENDING)[keyof typeof ORPHAN_ENDING];

/**
 * What one sweep came to: sessions closed with their seconds, sessions closed
 * as gone, sessions that answered nothing conclusive and stand for the next
 * sweep, and sessions whose write failed and stand for it as well.
 */
export interface VoiceOrphanSweepOutcome {
  closed: number;
  lost: number;
  pending: number;
  failed: number;
}

export const NOTHING_ORPHANED: VoiceOrphanSweepOutcome = {
  closed: 0,
  lost: 0,
  pending: 0,
  failed: 0,
};

export interface VoiceOrphanSweepSeams {
  /** Luke's own upstream, the one the voice functions attach through. */
  readonly upstream: LiveUpstream;
  readonly record: VoiceSessionRecord;
  /** The seconds ledger the service records a closed session through. */
  readonly recordSeconds: VoiceAccounts["recordSeconds"];
}

/** The avatar rows still open on an orphan whose voice row the sweep just closed. */
const closeOrphanedAvatars = (
  orphan: DetachedVoiceSession,
  now: number,
): Effect.Effect<void, unknown, DatabaseServices> =>
  Effect.asVoid(
    closeOpenAvatarSessionsOf({
      voiceSessionId: orphan.voiceSessionId,
      endedAt: new Date(now),
      reason: AVATAR_END_REASON.ORPHANED,
    }),
  );

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

/**
 * An orphan that answered nothing conclusive: closed as expired once it is
 * past OpenAI's duration limit, and otherwise stamped again, since it may be
 * a call still running that a sweep a grace later can end.
 */
const unanswered = (
  seams: VoiceOrphanSweepSeams,
  orphan: DetachedVoiceSession,
  now: number,
): Effect.Effect<OrphanEnding, unknown, DatabaseServices> =>
  now - orphan.startedAt < VOICE_SESSION_LIMIT_MS
    ? Effect.as(seams.record.sweepLater({ sessionId: orphan.sessionId }), ORPHAN_ENDING.PENDING)
    : Effect.as(
        Effect.andThen(
          seams.record.closeLost({
            sessionId: orphan.sessionId,
            reason: VOICE_CLOSE_REASON.EXPIRED,
          }),
          closeOrphanedAvatars(orphan, now),
        ),
        ORPHAN_ENDING.LOST,
      );

/** One orphan ended through a sideband of its own, written down as a connection that read the same ending would. */
const endOrphan = /* @__PURE__ */ Effect.fn("web/endOrphan")(function* (
  seams: VoiceOrphanSweepSeams,
  orphan: DetachedVoiceSession,
  now: number,
): Effect.fn.Return<OrphanEnding, unknown, DatabaseServices | Scope.Scope> {
  const { sessionId, userId } = orphan;
  const attached = yield* Effect.result(seams.upstream.attach(sessionId));
  if (Result.isFailure(attached)) {
    const { status } = attached.failure;
    if (status === undefined || !SESSION_GONE_STATUS.has(status)) {
      return yield* unanswered(seams, orphan, now);
    }
    yield* seams.record.closeLost({ sessionId, reason: VOICE_CLOSE_REASON.CONNECTION_LOST });
    yield* closeOrphanedAvatars(orphan, now);
    return ORPHAN_ENDING.LOST;
  }
  const socket = attached.success;
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
  if (ended.outcome !== SIDEBAND_CLOSE_OUTCOME.CLOSED) return yield* unanswered(seams, orphan, now);
  const seconds = ended.closed.usage.seconds;
  yield* seams.record.close({ sessionId, seconds, reason: ended.closed.reason });
  yield* closeOrphanedAvatars(orphan, now);
  yield* seams.recordSeconds({ userId, sessionId, seconds });
  return ORPHAN_ENDING.CLOSED;
});

/** Ends every session detached longer ago than the grace, oldest first and bounded, and counts how each ended. */
export const sweepVoiceOrphans = /* @__PURE__ */ Effect.fn("web/sweepVoiceOrphans")(function* (
  seams: VoiceOrphanSweepSeams,
  options: { readonly now: number },
): Effect.fn.Return<VoiceOrphanSweepOutcome, unknown, DatabaseServices> {
  const orphans = yield* seams.record.detached({
    detachedBefore: options.now - VOICE_DETACH_GRACE_MS,
    limit: VOICE_ORPHAN_SWEEP.MAX_SESSIONS,
  });
  const endings = yield* Effect.forEach(
    orphans,
    (orphan) => Effect.exit(Effect.scoped(endOrphan(seams, orphan, options.now))),
    { concurrency: VOICE_ORPHAN_SWEEP.CONCURRENCY },
  );
  // A repair that fails is the next sweep's to make again, never this one's outcome.
  yield* Effect.ignore(closeAvatarSessionsOfEndedCalls());
  const outcome = { ...NOTHING_ORPHANED };
  for (const ending of endings) {
    if (Exit.isFailure(ending)) outcome.failed += 1;
    else outcome[ending.value] += 1;
  }
  return outcome;
});
