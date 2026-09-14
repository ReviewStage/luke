import { randomUUID } from "node:crypto";
import { Deferred, Effect, type Fiber, type Scope, Stream } from "effect";
import {
  closeEvent,
  LIVE_SERVER_EVENT,
  type LiveClientEvent,
  type LiveServerEvent,
  type LiveSessionClosed,
  parseLiveServerEvent,
} from "../live.js";
import {
  desktopFrameDecision,
  FRAME_DECISION,
  frameType,
  upstreamFrameDecision,
  type VoiceRoute,
} from "./frames.js";
import { FINALIZATION, type Finalization, type RelayCounts } from "./log.js";
import {
  frameBytes,
  frameText,
  SOCKET_CLOSE_CODE,
  type VoiceFrame,
  type VoiceSocket,
} from "./socket.js";

/**
 * The pipe between one desktop socket and one OpenAI sideband, once both
 * stand. Each side's frames are a `Stream` read by a fiber of the session's
 * own scope, and they cross as the bytes they arrived as; the service reads
 * each frame's `type` and nothing else of it, drops reflected audio by that
 * type on every route, and on the introduction route admits only what a
 * renderer's own data channel would carry. An opening command the service
 * sends of its own once `session.started` arrives follows the docs' order:
 * the command, then its acknowledgment or refusal matched by the id it was
 * sent with under a bounded wait, then whatever the service answers
 * that with; a caller who has hung up is sent none of it, whichever side of
 * the start they went. It ends the way the docs say a
 * session ends: `session.closed` is the finalization, reported once with the
 * seconds it named; a desktop that goes first has `session.close` sent on
 * its behalf and the sideband held open for the final event under a
 * timeout; a sideband that goes first leaves the usage unconfirmed and takes
 * the desktop socket with it.
 *
 * A side going is its stream ending, so the two endings are read where every
 * other frame is; the two waits are `Effect.sleep` forked into the same scope,
 * which is what ends them when the session does.
 */

export const RELAY_DEFAULTS = {
  /** How long the sideband is held for `session.closed` after `session.close` was sent, the docs' 15 seconds. */
  CLOSE_TIMEOUT_MS: 15_000,
  /** How long an opening command is waited on for its acknowledgment before it is reported unanswered. */
  OPENING_TIMEOUT_MS: 15_000,
} as const;

/**
 * How the opening command the service sent on `session.started` was
 * answered. The docs' order is the append, its `session.instructions.appended`
 * matched by `client_event_id`, and only then whatever follows; an `error`
 * naming the same id is the refusal to handle before continuing, and silence
 * is neither, so each is reported as itself rather than assumed. An error
 * may name the id at its top level, inside `error` as `client_event_id`, or
 * inside `error` as `event_id`, and a refusal read from any of the three is
 * a refusal: one matched on fewer would be reported as silence instead.
 */
export const OPENING_OUTCOME = {
  ACKNOWLEDGED: "acknowledged",
  REFUSED: "refused",
  UNACKNOWLEDGED: "unacknowledged",
} as const;

/** A refusal carries the error's own kind and nothing of its free-text message. */
export type OpeningSettled =
  | { outcome: typeof OPENING_OUTCOME.ACKNOWLEDGED }
  | {
      outcome: typeof OPENING_OUTCOME.REFUSED;
      errorType: string | undefined;
      errorCode: string | undefined;
    }
  | { outcome: typeof OPENING_OUTCOME.UNACKNOWLEDGED };

/** The reason a desktop socket is closed with when OpenAI's side ended before `session.closed`. */
export const UPSTREAM_CLOSED_REASON = "upstream-closed";

export interface RelayOptions<R = never> {
  route: VoiceRoute;
  desktop: VoiceSocket;
  upstream: VoiceSocket;
  /** Runs once, on the first `session.closed`; the relay waits for it before settling. */
  onSessionClosed?: ((closed: LiveSessionClosed) => Effect.Effect<void, never, R>) | undefined;
  /** Runs on every `session.usage.updated`, with the seconds it named, on a fiber of its own. */
  onUsageUpdated?: ((seconds: number) => Effect.Effect<void, never, R>) | undefined;
  /** Asked once, on the first `session.started`, for an event to send upstream from the service's own side. */
  onSessionStarted?: (() => LiveClientEvent | undefined) | undefined;
  /** Asked once, with how that event was answered; an event it answers is sent upstream in turn. */
  onOpeningSettled?: ((settled: OpeningSettled) => LiveClientEvent | undefined) | undefined;
  closeTimeoutMs?: number;
  openingTimeoutMs?: number;
}

export interface RelaySummary extends RelayCounts {
  finalization: Finalization;
  /** The seconds `session.closed` named, once it was seen. */
  seconds: number | undefined;
}

/** Runs the pipe until the session is finalized or both transports are gone, and answers what it carried. */
export function relaySession<R = never>(
  options: RelayOptions<R>,
): Effect.Effect<RelaySummary, never, R | Scope.Scope> {
  const { route, desktop, upstream } = options;
  const closeTimeoutMs = options.closeTimeoutMs ?? RELAY_DEFAULTS.CLOSE_TIMEOUT_MS;
  const openingTimeoutMs = options.openingTimeoutMs ?? RELAY_DEFAULTS.OPENING_TIMEOUT_MS;

  return Effect.gen(function* () {
    const counts: RelayCounts = {
      framesToUpstream: 0,
      bytesToUpstream: 0,
      framesToDesktop: 0,
      bytesToDesktop: 0,
      droppedAudio: 0,
      droppedUnpermitted: 0,
    };
    let closedSeen = false;
    let startedSeen = false;
    /** Whether the caller has gone: an opening command is for someone still listening. */
    let hungUp = false;
    let closed: LiveSessionClosed | undefined;
    /** The `event_id` the opening command was sent with, until its acknowledgment settles it. */
    let openingEventId: string | undefined;
    let openingWait: Fiber.Fiber<void> | undefined;

    const settled = yield* Deferred.make<Finalization>();
    const settle = (finalization: Finalization): Effect.Effect<void> =>
      Effect.asVoid(Deferred.succeed(settled, finalization));

    const sendUpstream = (event: LiveClientEvent): Effect.Effect<void> =>
      Effect.flatMap(upstream.isOpen, (open) =>
        open ? upstream.send({ text: JSON.stringify(event) }) : Effect.void,
      );

    /**
     * The opening command's answer, handled once: the acknowledgment, the
     * refusal, or the wait running out. What the caller answers with goes up
     * in turn, which is how the docs' cue follows the greeting rather than
     * racing it.
     */
    const settleOpening = (opening: OpeningSettled): Effect.Effect<void> =>
      Effect.suspend(() => {
        if (openingEventId === undefined) return Effect.void;
        openingEventId = undefined;
        const waiting = openingWait;
        openingWait = undefined;
        const next = options.onOpeningSettled?.(opening);
        const sending = next === undefined ? Effect.void : sendUpstream(next);
        return waiting === undefined
          ? sending
          : Effect.andThen(
              Effect.sync(() => waiting.interruptUnsafe()),
              sending,
            );
      });

    /** How a server event answers the opening command, or nothing when it is about something else. */
    const openingAnswer = (event: LiveServerEvent): OpeningSettled | undefined => {
      if (event.type === LIVE_SERVER_EVENT.ERROR) {
        const about = event.client_event_id ?? event.error.client_event_id ?? event.error.event_id;
        return about === openingEventId
          ? {
              outcome: OPENING_OUTCOME.REFUSED,
              errorType: event.error.type,
              errorCode: event.error.code,
            }
          : undefined;
      }
      if (event.type !== LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED) return undefined;
      return event.client_event_id === openingEventId
        ? { outcome: OPENING_OUTCOME.ACKNOWLEDGED }
        : undefined;
    };

    const armOpening = Effect.fnUntraced(function* (
      opening: LiveClientEvent,
    ): Effect.fn.Return<void, never, Scope.Scope> {
      openingEventId = opening.event_id;
      openingWait = yield* Effect.forkScoped(
        Effect.sleep(openingTimeoutMs).pipe(
          // Cleared before the settle it runs, so the settle interrupts no
          // fiber: the one it would interrupt is this one.
          Effect.andThen(
            Effect.sync(() => {
              openingWait = undefined;
            }),
          ),
          Effect.andThen(settleOpening({ outcome: OPENING_OUTCOME.UNACKNOWLEDGED })),
        ),
      );
    });

    /**
     * The finalization, which settles whatever the caller's own close write
     * came to: run to its `Exit` rather than awaited, because a write that
     * failed or died is still a session that ended, and a defect carried into
     * the settle would leave the pipe waiting on a `Deferred` nothing
     * completes.
     */
    const finalize: Effect.Effect<void, never, R> = Effect.suspend(() =>
      closed !== undefined && options.onSessionClosed
        ? Effect.andThen(
            Effect.exit(options.onSessionClosed(closed)),
            settle(FINALIZATION.CONFIRMED),
          )
        : settle(FINALIZATION.CONFIRMED),
    );

    const onUpstreamFrame = Effect.fnUntraced(function* (frame: VoiceFrame) {
      const text = frameText(frame);
      const type = frameType(text);
      const decision = upstreamFrameDecision(type, route);
      if (decision === FRAME_DECISION.DROP_AUDIO) {
        counts.droppedAudio += 1;
      } else if (decision === FRAME_DECISION.DROP_UNPERMITTED) {
        counts.droppedUnpermitted += 1;
      } else if (yield* desktop.isOpen) {
        yield* desktop.send(frame);
        counts.framesToDesktop += 1;
        counts.bytesToDesktop += frameBytes(frame);
      }
      if (type === LIVE_SERVER_EVENT.SESSION_STARTED && !startedSeen) {
        startedSeen = true;
        const opening = hungUp ? undefined : options.onSessionStarted?.();
        if (opening !== undefined && (yield* upstream.isOpen)) {
          yield* upstream.send({ text: JSON.stringify(opening) });
          yield* armOpening(opening);
          // The caller may have gone while the command was going up, on the
          // fiber reading their own socket: an opening armed behind a hangup
          // is settled here rather than left to cue a session on its way out,
          // which is what the hangup itself would have done had it run first.
          if (hungUp) yield* settleOpening({ outcome: OPENING_OUTCOME.UNACKNOWLEDGED });
        }
      }
      if (
        openingEventId !== undefined &&
        (type === LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED || type === LIVE_SERVER_EVENT.ERROR)
      ) {
        const event = parseLiveServerEvent(text);
        const answer = event === undefined ? undefined : openingAnswer(event);
        if (answer !== undefined) yield* settleOpening(answer);
      }
      if (type === LIVE_SERVER_EVENT.USAGE_UPDATED && options.onUsageUpdated) {
        const updated = parseLiveServerEvent(text);
        if (updated?.type === LIVE_SERVER_EVENT.USAGE_UPDATED) {
          // On its own fiber, since a snapshot is not what the pipe waits
          // on, and uninterruptible, since the scope closing on a session
          // that ended unconfirmed would otherwise cut the last snapshot
          // the row will ever hold.
          yield* Effect.forkScoped(
            Effect.uninterruptible(options.onUsageUpdated(updated.usage.seconds)),
          );
        }
      }
      if (type === LIVE_SERVER_EVENT.SESSION_CLOSED && !closedSeen) {
        closedSeen = true;
        const event = parseLiveServerEvent(text);
        if (event?.type === LIVE_SERVER_EVENT.SESSION_CLOSED) closed = event;
        yield* Effect.forkScoped(finalize);
      }
    });

    const onUpstreamGone = Effect.suspend(() =>
      closedSeen ? Effect.void : settle(FINALIZATION.UNCONFIRMED),
    );

    const onDesktopFrame = Effect.fnUntraced(function* (frame: VoiceFrame) {
      const decision = desktopFrameDecision(frameType(frameText(frame)), route);
      if (decision !== FRAME_DECISION.FORWARD) {
        counts.droppedUnpermitted += 1;
        return;
      }
      if (!(yield* upstream.isOpen)) return;
      yield* upstream.send(frame);
      counts.framesToUpstream += 1;
      counts.bytesToUpstream += frameBytes(frame);
    });

    /**
     * The desktop went first. The docs' graceful close on its behalf: the
     * sideband's own stream is already read, `session.close` goes up, and the
     * sideband is held for the final event so the seconds are recorded, under
     * the timeout after which finalization is reported incomplete.
     */
    const onDesktopGone = Effect.gen(function* () {
      hungUp = true;
      if (closedSeen || (yield* Deferred.isDone(settled))) return;
      // The caller has hung up, so the opening command will never be answered
      // to any purpose: it is settled as unanswered here rather than left
      // armed, where an acknowledgment arriving during the graceful close
      // would cue a session already on its way out.
      yield* settleOpening({ outcome: OPENING_OUTCOME.UNACKNOWLEDGED });
      if (!(yield* upstream.isOpen)) {
        yield* settle(FINALIZATION.UNCONFIRMED);
        return;
      }
      yield* upstream.send({ text: JSON.stringify(closeEvent(randomUUID())) });
      yield* Effect.forkScoped(
        Effect.sleep(closeTimeoutMs).pipe(
          Effect.andThen(
            Effect.suspend(() => (closedSeen ? Effect.void : settle(FINALIZATION.UNCONFIRMED))),
          ),
        ),
      );
    });

    yield* Effect.forkScoped(
      Effect.andThen(Stream.runForEach(upstream.frames, onUpstreamFrame), onUpstreamGone),
    );
    yield* Effect.forkScoped(
      Effect.andThen(Stream.runForEach(desktop.frames, onDesktopFrame), onDesktopGone),
    );

    const finalization = yield* Deferred.await(settled);
    openingEventId = undefined;
    if (yield* desktop.isOpen) {
      yield* finalization === FINALIZATION.CONFIRMED
        ? desktop.close(SOCKET_CLOSE_CODE.NORMAL)
        : desktop.close(SOCKET_CLOSE_CODE.GOING_AWAY, UPSTREAM_CLOSED_REASON);
    }
    if (yield* upstream.isOpen) yield* upstream.close(SOCKET_CLOSE_CODE.NORMAL);
    return { ...counts, finalization, seconds: closed?.usage.seconds };
  });
}
