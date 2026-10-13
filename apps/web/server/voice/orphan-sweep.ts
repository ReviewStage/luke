import { randomUUID } from "node:crypto";
import {
  closeAvatarSession,
  type OpenAvatarSession,
  openAvatarSessionsOfEndedCalls,
} from "@sidecar/database/models/voice-avatar-sessions";
import type {
  DetachedVoiceSession,
  VoiceSessionRecord,
} from "@sidecar/database/models/voice-session-record";
import { AVATAR_END_REASON, VOICE_CLOSE_REASON } from "@sidecar/database/voice-vocabulary";
import {
  closeGracefully,
  type LiveSideband,
  SIDEBAND_CLOSE_OUTCOME,
  type SidebandCloseResult,
} from "@sidecar/voice/live-session";
import { Deferred, Effect, Exit, Result, type Scope, Stream } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { LIVE_SERVER_EVENT } from "../live.js";
import type { VoiceAccounts } from "./accounts.js";
import { upstreamSideband } from "./live-sideband.js";
import { LIVEAVATAR_STOP_REASON, type LiveAvatarService } from "./liveavatar.js";
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
 * closed as expired instead.
 *
 * Once the calls are ended, the avatars of calls that have ended are let
 * go of: an avatar session still open on a closed call, this sweep's orphans
 * among them, shows a voice that is gone, so it is stopped at LiveAvatar,
 * one LiveAvatar no longer knows counting as already ended, and its row
 * closed as its media lost. An avatar on a call left pending is not touched,
 * since its device may yet come back to it. A stop LiveAvatar refused or
 * never answered leaves the row open for the next sweep, and a row past
 * LiveAvatar's longest cap is closed at that cap without a stop, since
 * LiveAvatar has ended the session whatever it answers; so a few that never
 * answer hold the oldest places for at most the cap. A deployment without
 * the LiveAvatar key closes the rows without a stop, as it has nothing to
 * stop them with.
 *
 * Each sweep takes at most `MAX_SESSIONS` of the oldest orphans and then at
 * most `MAX_AVATARS` of the oldest avatars, `CONCURRENCY` at a time, each
 * orphan bounded by the attach's own wait and the close's and each avatar by
 * its stop, so the sweep takes at most two rounds of each out of the
 * function's duration.
 */

/** How long a detached session waits for its device before the sweep ends it: past the Mac's own re-attach of some ten seconds. */
export const VOICE_DETACH_GRACE_MS = 60_000;

/** The longest a Live session runs before OpenAI ends it as `expired`: past it, a session that answers nothing is gone. */
export const VOICE_SESSION_LIMIT_MS = 60 * 60_000;

/** The longest LiveAvatar lets a session run on any plan: past it, a session that answers nothing has ended. */
const AVATAR_SESSION_LIMIT_MS = 60 * 60_000;

/** The statuses OpenAI refuses an attach with when the session named no longer stands. */
const SESSION_GONE_STATUS: ReadonlySet<number> = new Set([404, 410]);

export const VOICE_ORPHAN_SWEEP = {
  MAX_SESSIONS: 20,
  MAX_AVATARS: 20,
  CONCURRENCY: 10,
  /** How long the fresh sideband is given to stand, which the sweep's upstream is built with. */
  ATTACH_TIMEOUT_MS: 5_000,
  /** How long `session.closed` is waited on once `session.close` went up. */
  CLOSE_TIMEOUT_MS: 5_000,
  /** How long LiveAvatar is given to answer an avatar's stop, which the sweep's client is built with. */
  AVATAR_STOP_TIMEOUT_MS: 5_000,
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
 * sweep, and sessions whose write failed and stand for it as well; then the
 * avatar sessions of ended calls closed, and those whose stop or close failed
 * and stand open for the next sweep.
 */
export interface VoiceOrphanSweepOutcome {
  closed: number;
  lost: number;
  pending: number;
  failed: number;
  avatarsClosed: number;
  avatarsLeftOpen: number;
}

export const NOTHING_ORPHANED: VoiceOrphanSweepOutcome = {
  closed: 0,
  lost: 0,
  pending: 0,
  failed: 0,
  avatarsClosed: 0,
  avatarsLeftOpen: 0,
};

/** How one avatar of an ended call came out: its row closed, or left open for the next sweep. */
const AVATAR_ENDING = {
  CLOSED: "avatarsClosed",
  LEFT_OPEN: "avatarsLeftOpen",
} as const;

type AvatarEnding = (typeof AVATAR_ENDING)[keyof typeof AVATAR_ENDING];

export interface VoiceOrphanSweepSeams {
  /** Luke's own upstream, the one the voice functions attach through. */
  readonly upstream: LiveUpstream;
  readonly record: VoiceSessionRecord;
  /** The seconds ledger the service records a closed session through. */
  readonly recordSeconds: VoiceAccounts["recordSeconds"];
  /** Luke's own LiveAvatar client, the one the voice service starts avatars on; absent without the key. */
  readonly avatar: LiveAvatarService | undefined;
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

/**
 * An orphan that answered nothing conclusive: closed as expired once it is
 * past OpenAI's duration limit, and otherwise stamped again, since it may be
 * a call still running that a sweep a grace later can end.
 */
const unanswered = (
  seams: VoiceOrphanSweepSeams,
  orphan: DetachedVoiceSession,
  now: number,
): Effect.Effect<OrphanEnding, unknown, SqlClient.SqlClient> =>
  now - orphan.startedAt < VOICE_SESSION_LIMIT_MS
    ? Effect.as(seams.record.sweepLater({ sessionId: orphan.sessionId }), ORPHAN_ENDING.PENDING)
    : Effect.as(
        seams.record.closeLost({ sessionId: orphan.sessionId, reason: VOICE_CLOSE_REASON.EXPIRED }),
        ORPHAN_ENDING.LOST,
      );

/**
 * One avatar of an ended call stopped and its row closed as its media lost;
 * one past LiveAvatar's longest cap is closed at that cap without a stop.
 */
const endAvatar = /* @__PURE__ */ Effect.fn("web/endAvatar")(function* (
  seams: VoiceOrphanSweepSeams,
  session: OpenAvatarSession,
  now: number,
): Effect.fn.Return<AvatarEnding, unknown, SqlClient.SqlClient> {
  const { liveAvatarSessionId } = session;
  const capped = session.startedAt.getTime() + AVATAR_SESSION_LIMIT_MS;
  if (now < capped && seams.avatar !== undefined) {
    const stopped = yield* Effect.exit(
      seams.avatar.stop(liveAvatarSessionId, LIVEAVATAR_STOP_REASON.ZOMBIE_SESSION_REAP),
    );
    if (Exit.isFailure(stopped)) return AVATAR_ENDING.LEFT_OPEN;
  }
  yield* closeAvatarSession({
    liveAvatarSessionId,
    endedAt: new Date(Math.min(now, capped)),
    reason: AVATAR_END_REASON.MEDIA_LOST,
  });
  return AVATAR_ENDING.CLOSED;
});

/** One orphan ended through a sideband of its own, written down as a connection that read the same ending would. */
const endOrphan = /* @__PURE__ */ Effect.fn("web/endOrphan")(function* (
  seams: VoiceOrphanSweepSeams,
  orphan: DetachedVoiceSession,
  now: number,
): Effect.fn.Return<OrphanEnding, unknown, SqlClient.SqlClient | Scope.Scope> {
  const { sessionId, userId } = orphan;
  const attached = yield* Effect.result(seams.upstream.attach(sessionId));
  if (Result.isFailure(attached)) {
    const { status } = attached.failure;
    if (status === undefined || !SESSION_GONE_STATUS.has(status)) {
      return yield* unanswered(seams, orphan, now);
    }
    yield* seams.record.closeLost({ sessionId, reason: VOICE_CLOSE_REASON.CONNECTION_LOST });
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
  yield* seams.recordSeconds({ userId, sessionId, seconds });
  return ORPHAN_ENDING.CLOSED;
});

/**
 * Ends every session detached longer ago than the grace, then stops the
 * avatars left on ended calls, each oldest first and bounded, and counts how
 * each came out.
 */
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
    (orphan) => Effect.exit(Effect.scoped(endOrphan(seams, orphan, options.now))),
    { concurrency: VOICE_ORPHAN_SWEEP.CONCURRENCY },
  );
  // Note that the avatars are read after the calls are ended, because an
  // avatar is stopped only once its call has closed, this sweep's included.
  const avatars = yield* openAvatarSessionsOfEndedCalls({ limit: VOICE_ORPHAN_SWEEP.MAX_AVATARS });
  const avatarEndings = yield* Effect.forEach(
    avatars,
    (session) => Effect.exit(endAvatar(seams, session, options.now)),
    { concurrency: VOICE_ORPHAN_SWEEP.CONCURRENCY },
  );
  const outcome = { ...NOTHING_ORPHANED };
  for (const ending of endings) {
    if (Exit.isFailure(ending)) outcome.failed += 1;
    else outcome[ending.value] += 1;
  }
  for (const ending of avatarEndings) {
    outcome[Exit.isFailure(ending) ? AVATAR_ENDING.LEFT_OPEN : ending.value] += 1;
  }
  return outcome;
});
