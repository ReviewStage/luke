/**
 * avatar.ts -- one call's Keyframe avatar: the desktop's asks answered on Luke's key, and each session's row kept.
 *
 * The desktop asks for the avatar with `avatar.start` and takes it down with
 * `avatar.stop`, each naming the request id the host minted, and this
 * answers every start with that id echoed: `avatar.started` carrying a grant
 * minted for this ask alone, since a grant joins once and is never kept, or
 * `avatar.unavailable` with why. The grant goes to the device socket and
 * nowhere else; the one word the log keeps of it is the host of the room.
 *
 * Each session Keyframe mints is a `voice_avatar_sessions` row, opened only
 * on a voice session the account owns and that is still open, and closed
 * once: by the desktop's stop, by the next start (a call holds one avatar),
 * by the hang-up, and by the voice row's close, which the service writes
 * first so a start racing it opens nothing (the model's shared lock).
 *
 * The asks are taken in turn by one fiber of the session's scope, so a stop
 * sent right behind its start closes the row that start opened.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  closeAvatarSession,
  closeOpenAvatarSessionsOf,
  openAvatarSession,
} from "@luke/database/models/voice-avatar-sessions";
import { AVATAR_END_REASON, type AvatarEndReason } from "@luke/database/voice-vocabulary";
import { catchAllButInterrupt, serialQueue } from "@luke/runtime/effect";
import { Clock, Effect, Option, Result, type Scope } from "effect";
import {
  AVATAR_STOP_REASON,
  AVATAR_UNAVAILABLE_REASON,
  type AvatarRequestFrame,
  type AvatarStartedFrame,
  type AvatarStopFrame,
  type AvatarStopReason,
  type AvatarUnavailableFrame,
  type AvatarUnavailableReason,
  avatarStartedFrameFromWire,
  unparsedWire,
  VOICE_SERVICE_FRAME,
} from "../core.js";
import { KEYFRAME_FAILURE, type KeyframeFailure, type KeyframeService } from "./keyframe.js";
import { LOG_EVENT, type Log } from "./log.js";

/** Why a row closes, for each reason the desktop stops the avatar with. */
const END_REASON_OF_STOP = {
  [AVATAR_STOP_REASON.USER]: AVATAR_END_REASON.USER,
  [AVATAR_STOP_REASON.SERVER_CLOSED]: AVATAR_END_REASON.SERVER_CLOSED,
  [AVATAR_STOP_REASON.ERROR]: AVATAR_END_REASON.ERROR,
} as const satisfies Record<AvatarStopReason, AvatarEndReason>;

/** What the desktop is told, for each way Keyframe refused to mint. */
const UNAVAILABLE_REASON_OF_FAILURE = {
  [KEYFRAME_FAILURE.NO_CAPACITY]: AVATAR_UNAVAILABLE_REASON.NO_CAPACITY,
  [KEYFRAME_FAILURE.TASK_REFUSED]: AVATAR_UNAVAILABLE_REASON.ERROR,
  [KEYFRAME_FAILURE.UPSTREAM]: AVATAR_UNAVAILABLE_REASON.ERROR,
} as const satisfies Record<KeyframeFailure, AvatarUnavailableReason>;

/** The deployment's Keyframe client and the persona it mints, both configured or the avatar is not. */
export interface AvatarProvider {
  readonly keyframe: KeyframeService;
  readonly personaId: string;
}

export interface CallAvatarOptions {
  /** None where this deployment holds no Keyframe key or persona: every start is answered not configured. */
  readonly provider: AvatarProvider | undefined;
  readonly userId: string;
  /** The call's row, which every avatar row names; none where the row is another account's. */
  readonly voiceSessionId: string | undefined;
  /** Whether the device is still there to be answered: a start for a device gone mints nothing. */
  readonly deviceOpen: Effect.Effect<boolean>;
  readonly send: (frame: AvatarStartedFrame | AvatarUnavailableFrame) => Effect.Effect<void>;
  readonly log: Log;
}

export interface CallAvatar {
  /** Takes one ask the device sent, from the relay's own callback; answered in the order taken. */
  readonly request: (frame: AvatarRequestFrame) => void;
  /** The device hung up: what stands closes as the call's end, and nothing starts after. */
  readonly hangUp: () => void;
  /**
   * Closes every avatar row still open on the call, once its voice row is
   * closed, whether or not this instance can mint one: a call re-attached
   * here may show an avatar another instance put up. A close that fails here
   * is repaired by the sweep, which closes the rows of every closed call.
   */
  readonly callClosed: Effect.Effect<void, never, DatabaseServices>;
}

/** Note that the instant is the Effect clock's, so a test drives it with `TestClock`. */
const currentInstant = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis));

/**
 * The grant as the frame the desktop reads, or nothing where Keyframe
 * answered one the desktop would refuse (a room not on `wss:`, a token past
 * the bound), so the refusal is the service's answer rather than silence.
 */
function startedFrame(grant: AvatarStartedFrame): AvatarStartedFrame | undefined {
  return avatarStartedFrameFromWire(unparsedWire(grant));
}

/** One call's avatar, standing for the session's scope. */
export const callAvatar = /* @__PURE__ */ Effect.fnUntraced(function* (
  options: CallAvatarOptions,
): Effect.fn.Return<CallAvatar, never, Scope.Scope | DatabaseServices> {
  const { provider, userId, voiceSessionId, log } = options;
  /** The row this connection's latest start opened, with that start's request id. */
  let held: { readonly requestId: string; readonly rowId: string } | undefined;
  let hungUp = false;
  /** When this connection began, which bounds what a stop it holds no row for may close. */
  const connectedAt = yield* currentInstant;
  const failed = Effect.sync(() => log({ event: LOG_EVENT.SESSION_FAILED }));
  const queue = yield* serialQueue<DatabaseServices>({
    onDefect: () => failed,
    drainOnClose: true,
  });

  const unavailable = (requestId: string, reason: AvatarUnavailableReason, status?: number) =>
    Effect.andThen(
      Effect.sync(() => log({ event: LOG_EVENT.AVATAR_UNAVAILABLE, reason, status })),
      options.send({ type: VOICE_SERVICE_FRAME.AVATAR_UNAVAILABLE, requestId, reason }),
    );

  const closeOpen = (id: string, reason: AvatarEndReason, startedBy?: Date) =>
    Effect.flatMap(currentInstant, (endedAt) =>
      closeOpenAvatarSessionsOf({ voiceSessionId: id, endedAt, reason, startedBy }),
    );

  // Note that whatever the call already shows is closed before Keyframe is
  // asked, so a start that then fails leaves no row of the old one open.
  const start = (requestId: string, call: string, avatar: AvatarProvider) =>
    Effect.gen(function* () {
      yield* closeOpen(call, AVATAR_END_REASON.USER);
      held = undefined;
      const minted = yield* Effect.result(avatar.keyframe.createSession());
      if (Result.isFailure(minted)) {
        const { failure, status } = minted.failure;
        return yield* unavailable(requestId, UNAVAILABLE_REASON_OF_FAILURE[failure], status);
      }
      // The device may have hung up while Keyframe minted: no grant reaches
      // a caller who asked to end the call, and no row opens for it.
      if (hungUp) return yield* unavailable(requestId, AVATAR_UNAVAILABLE_REASON.ERROR);
      const frame = startedFrame({
        type: VOICE_SERVICE_FRAME.AVATAR_STARTED,
        requestId,
        ...minted.success,
      });
      if (frame === undefined)
        return yield* unavailable(requestId, AVATAR_UNAVAILABLE_REASON.ERROR);
      const startedAt = yield* currentInstant;
      const opened = yield* openAvatarSession({
        userId,
        voiceSessionId: call,
        personaId: avatar.personaId,
        startedAt,
      });
      if (Option.isNone(opened)) {
        return yield* unavailable(requestId, AVATAR_UNAVAILABLE_REASON.ERROR);
      }
      held = { requestId, rowId: opened.value };
      yield* options.send(frame);
      log({ event: LOG_EVENT.AVATAR_STARTED, host: new URL(frame.serverUrl).host });
    });

  const answerStart = (requestId: string) =>
    Effect.gen(function* () {
      if (!(yield* options.deviceOpen)) return;
      if (provider === undefined) {
        return yield* unavailable(requestId, AVATAR_UNAVAILABLE_REASON.NOT_CONFIGURED);
      }
      if (hungUp || voiceSessionId === undefined) {
        return yield* unavailable(requestId, AVATAR_UNAVAILABLE_REASON.ERROR);
      }
      // A write that failed is still a start the device waits on an answer for.
      yield* catchAllButInterrupt(start(requestId, voiceSessionId, provider), () =>
        Effect.andThen(failed, unavailable(requestId, AVATAR_UNAVAILABLE_REASON.ERROR)),
      );
    });

  /**
   * The stop of the row the request opened. A stop for an earlier request
   * than the one this connection holds is late and closes nothing; one this
   * connection holds none for is about an avatar an earlier connection put
   * up, and closes what the call shows that started by the instant this
   * connection began (a row of the same millisecond included, since a newer
   * connection's own row waits on a Keyframe mint after that), so a newer
   * connection's avatar is never closed by a stop that is not its.
   */
  const answerStop = (frame: AvatarStopFrame) =>
    Effect.gen(function* () {
      if (voiceSessionId === undefined) return;
      const reason = END_REASON_OF_STOP[frame.reason];
      if (held === undefined) {
        yield* closeOpen(voiceSessionId, reason, connectedAt);
        return;
      }
      if (held.requestId !== frame.requestId) return;
      const id = held.rowId;
      held = undefined;
      const endedAt = yield* currentInstant;
      yield* closeAvatarSession({ id, endedAt, reason });
    });

  const written = <E>(work: Effect.Effect<void, E, DatabaseServices>) =>
    Effect.asVoid(catchAllButInterrupt(work, () => failed));

  return {
    request: (frame) => {
      queue.offerUnsafe(
        frame.type === VOICE_SERVICE_FRAME.AVATAR_START
          ? answerStart(frame.requestId)
          : written(answerStop(frame)),
      );
    },
    hangUp: () => {
      hungUp = true;
      if (voiceSessionId === undefined) return;
      const call = voiceSessionId;
      queue.offerUnsafe(
        written(
          Effect.andThen(
            Effect.sync(() => {
              held = undefined;
            }),
            closeOpen(call, AVATAR_END_REASON.CALL_ENDED),
          ),
        ),
      );
    },
    callClosed:
      voiceSessionId === undefined
        ? Effect.void
        : written(closeOpen(voiceSessionId, AVATAR_END_REASON.CALL_ENDED)),
  };
});
