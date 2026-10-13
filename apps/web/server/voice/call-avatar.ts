/**
 * call-avatar.ts -- Luke's face on one call: the LiveAvatar session the device asks for, started, recorded, and stopped.
 *
 * The device asks for the face with `avatar.start` and takes it down with
 * `avatar.stop`; the call ending, by its hang-up or by `session.closed`,
 * takes it down too. A face is a LiveAvatar session on Luke's key and a
 * `voice_avatar_sessions` row against the call's own row, and the rows are
 * what this module reads to find the face still up: a call outlives the
 * connection that started its face, since a device re-attaches on another
 * function instance, so the connection that stops it may be one that never
 * held its grant. A call shows one face at a time, so a start stops any
 * still recorded open before it mints another, and the asks of one
 * connection are taken one at a time, so a stop never reads the rows ahead
 * of the start it follows.
 *
 * A stop LiveAvatar refused leaves its row open, which is what the sweep
 * reads to stop it again. What the device is answered carries LiveAvatar's
 * grant and a fixed reason, and what the log keeps is the event and that
 * reason, never an id or a token.
 */

import {
  closeAvatarSession,
  openAvatarSession,
  openAvatarSessionsOf,
} from "@sidecar/database/models/voice-avatar-sessions";
import {
  AVATAR_END_REASON as AVATAR_RECORD_REASON,
  type AvatarEndReason as AvatarRecordReason,
} from "@sidecar/database/voice-vocabulary";
import { catchAllButInterrupt } from "@sidecar/runtime/effect";
import { Clock, Effect, Option, Schema, Semaphore } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import {
  AVATAR_STOP_REASON,
  AVATAR_UNAVAILABLE_REASON,
  type AvatarEndedFrame,
  type AvatarStartedFrame,
  type AvatarStopReason,
  type AvatarUnavailableFrame,
  type AvatarUnavailableReason,
  avatarStartedFrameSchema,
  VOICE_SERVICE_FRAME,
} from "../core.js";
import {
  LIVEAVATAR_STOP_REASON,
  type LiveAvatarService,
  type LiveAvatarStopReason,
} from "./liveavatar.js";
import { LOG_EVENT, type Log } from "./log.js";

/** How a face on the call came down. */
export const CALL_AVATAR_ENDING = {
  /** The developer turned the video off. */
  TURNED_OFF: "turned-off",
  /** The host lost the media socket it speaks Luke's audio into. */
  MEDIA_LOST: "media-lost",
  /** A fresh start took the place of a face still up. */
  REPLACED: "replaced",
  /** The developer hung up. */
  HUNG_UP: "hung-up",
  /** OpenAI said the call's session closed. */
  CALL_CLOSED: "call-closed",
} as const;

export type CallAvatarEnding = (typeof CALL_AVATAR_ENDING)[keyof typeof CALL_AVATAR_ENDING];

/** The endings that are the call's own rather than an ask of the device's. */
type CallEnding = typeof CALL_AVATAR_ENDING.HUNG_UP | typeof CALL_AVATAR_ENDING.CALL_CLOSED;

/** How one ending is written at LiveAvatar and on the row. */
interface EndingTerms {
  readonly liveAvatar: LiveAvatarStopReason;
  readonly record: AvatarRecordReason;
}

/**
 * Each ending in the words of the two places it is written: LiveAvatar's own
 * stop reason, and the row's end reason. The vocabularies are separate, so
 * each is named here rather than one read as the other.
 */
const ENDING_TERMS = {
  [CALL_AVATAR_ENDING.TURNED_OFF]: {
    liveAvatar: LIVEAVATAR_STOP_REASON.USER_CLOSED,
    record: AVATAR_RECORD_REASON.USER,
  },
  [CALL_AVATAR_ENDING.MEDIA_LOST]: {
    liveAvatar: LIVEAVATAR_STOP_REASON.SERVER_ERROR,
    record: AVATAR_RECORD_REASON.MEDIA_LOST,
  },
  [CALL_AVATAR_ENDING.REPLACED]: {
    liveAvatar: LIVEAVATAR_STOP_REASON.USER_CLOSED,
    record: AVATAR_RECORD_REASON.USER,
  },
  [CALL_AVATAR_ENDING.HUNG_UP]: {
    liveAvatar: LIVEAVATAR_STOP_REASON.USER_CLOSED,
    record: AVATAR_RECORD_REASON.USER,
  },
  [CALL_AVATAR_ENDING.CALL_CLOSED]: {
    liveAvatar: LIVEAVATAR_STOP_REASON.USER_DISCONNECTED,
    record: AVATAR_RECORD_REASON.USER,
  },
} as const satisfies { readonly [Ending in CallAvatarEnding]: EndingTerms };

/** The ending each of the device's stop reasons names. */
const STOP_ENDING = {
  [AVATAR_STOP_REASON.USER]: CALL_AVATAR_ENDING.TURNED_OFF,
  [AVATAR_STOP_REASON.MEDIA_LOST]: CALL_AVATAR_ENDING.MEDIA_LOST,
} as const satisfies { readonly [Reason in AvatarStopReason]: CallAvatarEnding };

/** Whether a grant answers a frame the desktop reads: a room or socket off `wss:` is a face no one would see. */
const isReadableStart = Schema.is(avatarStartedFrameSchema);

/** What the service answers the device about its face. */
export type AvatarAnswerFrame = AvatarStartedFrame | AvatarEndedFrame | AvatarUnavailableFrame;

export interface CallAvatarOptions {
  /** LiveAvatar on Luke's key; absent where the deployment configured none. */
  readonly liveAvatar: LiveAvatarService | undefined;
  /** The account the call is billed to. */
  readonly userId: string;
  /** The call's own row; absent where its register landed none, and then no face can be recorded against it. */
  readonly voiceSessionId: string | undefined;
  /** Sends one answer to the device; a device gone takes it nowhere. */
  readonly answer: (frame: AvatarAnswerFrame) => Effect.Effect<void>;
  readonly log: Log;
}

type AvatarEffect = Effect.Effect<void, never, SqlClient.SqlClient>;

export interface CallAvatar {
  /** Puts the face up, taking down any still recorded open first, and answers `avatar.started` or `avatar.unavailable`. */
  readonly start: AvatarEffect;
  /** Takes the face down at the device's ask, and answers `avatar.ended` with the device's own reason. */
  readonly stop: (reason: AvatarStopReason) => AvatarEffect;
  /** Takes the face down because the call is over; nothing is answered, and nothing starts after. */
  readonly end: (ending: CallEnding) => AvatarEffect;
}

/** The face of one connection's call, its asks taken one at a time. */
export function callAvatar(options: CallAvatarOptions): Effect.Effect<CallAvatar> {
  const { liveAvatar, userId, voiceSessionId, answer, log } = options;
  return Effect.map(Semaphore.make(1), (semaphore) => {
    const serial = semaphore.withPermits(1);
    /** Whether the call is over, so a start still queued behind the end puts nothing up. */
    let over = false;
    const failed = Effect.sync(() => log({ event: LOG_EVENT.AVATAR_FAILED }));

    const unavailable = (reason: AvatarUnavailableReason) =>
      Effect.andThen(
        Effect.sync(() => log({ event: LOG_EVENT.AVATAR_UNAVAILABLE, reason })),
        answer({ type: VOICE_SERVICE_FRAME.AVATAR_UNAVAILABLE, reason }),
      );

    /** One face stopped at LiveAvatar and then its row closed; a stop refused leaves the row open for the sweep. */
    const stopOne = (
      service: LiveAvatarService,
      liveAvatarSessionId: string,
      ending: CallAvatarEnding,
    ) =>
      Effect.gen(function* () {
        const terms = ENDING_TERMS[ending];
        yield* service.stop(liveAvatarSessionId, terms.liveAvatar);
        const endedAt = new Date(yield* Clock.currentTimeMillis);
        yield* closeAvatarSession({ liveAvatarSessionId, endedAt, reason: terms.record });
        log({ event: LOG_EVENT.AVATAR_ENDED, ending });
      });

    /** Every face still recorded open on the call, whichever connection put it up, taken down. */
    const stopOpen = (ending: CallAvatarEnding): AvatarEffect =>
      Effect.suspend(() => {
        if (liveAvatar === undefined || voiceSessionId === undefined) return Effect.void;
        const stopping = Effect.gen(function* () {
          const open = yield* openAvatarSessionsOf({ userId, voiceSessionId });
          for (const session of open) {
            // Each on its own, so one LiveAvatar refused leaves the rest to come down.
            yield* catchAllButInterrupt(
              stopOne(liveAvatar, session.liveAvatarSessionId, ending),
              () => failed,
            );
          }
        });
        return catchAllButInterrupt(stopping, () => failed);
      });

    const start: AvatarEffect = serial(
      Effect.gen(function* () {
        if (over) return;
        if (liveAvatar === undefined)
          return yield* unavailable(AVATAR_UNAVAILABLE_REASON.NOT_CONFIGURED);
        if (voiceSessionId === undefined)
          return yield* unavailable(AVATAR_UNAVAILABLE_REASON.ERROR);
        yield* stopOpen(CALL_AVATAR_ENDING.REPLACED);
        const granted = yield* Effect.option(liveAvatar.start());
        if (Option.isNone(granted)) return yield* unavailable(AVATAR_UNAVAILABLE_REASON.ERROR);
        const grant = granted.value;
        const frame: AvatarStartedFrame = {
          type: VOICE_SERVICE_FRAME.AVATAR_STARTED,
          avatarSessionId: grant.sessionId,
          livekitUrl: grant.livekitUrl,
          viewerToken: grant.viewerToken,
          mediaUrl: grant.mediaUrl,
          maxSeconds: grant.maxSeconds,
        };
        const startedAt = new Date(yield* Clock.currentTimeMillis);
        const opened = isReadableStart(frame)
          ? yield* Effect.orElseSucceed(
              openAvatarSession({
                userId,
                voiceSessionId,
                liveAvatarSessionId: grant.sessionId,
                startedAt,
              }),
              () => Option.none<string>(),
            )
          : Option.none<string>();
        // Note that a face with no row, or one the desktop could not read, is
        // stopped at once, because nothing would ever stop it again.
        if (Option.isNone(opened)) {
          yield* Effect.ignore(
            liveAvatar.stop(grant.sessionId, LIVEAVATAR_STOP_REASON.SERVER_ERROR),
          );
          return yield* unavailable(AVATAR_UNAVAILABLE_REASON.ERROR);
        }
        log({ event: LOG_EVENT.AVATAR_STARTED });
        yield* answer(frame);
      }),
    );

    const stop = (reason: AvatarStopReason): AvatarEffect =>
      Effect.andThen(
        serial(stopOpen(STOP_ENDING[reason])),
        answer({ type: VOICE_SERVICE_FRAME.AVATAR_ENDED, reason }),
      );

    const end = (ending: CallEnding): AvatarEffect =>
      Effect.andThen(
        Effect.sync(() => {
          over = true;
        }),
        serial(stopOpen(ending)),
      );

    return { start, stop, end };
  });
}
