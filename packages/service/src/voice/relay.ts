import { randomUUID } from "node:crypto";
import {
  closeEvent,
  decodeLivePayload,
  LIVE_SERVER_EVENT,
  type LiveClientEvent,
  type LiveSessionClosed,
  parseLiveServerEvent,
} from "@luke/live";
import { Deferred, Effect, type Scope, Stream } from "effect";
import {
  type AvatarRequestFrame,
  avatarRequestFrameFromWire,
  type SessionReportFrame,
  sessionReportFrameFromWire,
} from "../core.js";
import { deviceFrameDecision, FRAME_DECISION, frameType, upstreamFrameDecision } from "./frames.js";
import { FINALIZATION, type Finalization, type RelayCounts } from "./log.js";
import {
  frameBytes,
  frameText,
  SOCKET_CLOSE_CODE,
  type VoiceFrame,
  type VoiceSocket,
} from "./socket.js";

/**
 * The pipe between one device socket and the sideband the service attached
 * to its WebRTC session, once both stand. Each side's frames are a `Stream`
 * read by a fiber of the session's own scope, and they cross as the bytes
 * they arrived as; the service reads each frame's `type` and nothing else of
 * it, drops reflected audio by that type, and admits from the device only
 * the hang-up, read as an ask for the close, its idle report, its stop, and
 * its avatar asks, closing the socket on anything else. The reports and the
 * avatar asks are the frames read past their type: they are the service's
 * own vocabulary, handed to the exchange that holds the idle decision and the
 * one instruction the stop appends, or to the service that answers for the
 * avatar, never to OpenAI.
 * The relay sends nothing of its own as a session starts: a new call's
 * opening is in the history it was created with. It ends the way the docs say a
 * session ends: `session.closed` is the finalization, reported once with the
 * seconds it named; a device that goes first after asking for the close, or
 * once its socket was closed on a refused frame, has `session.close` sent on
 * its behalf and the sideband held open for the final event under a timeout.
 * That close is the exchange's where one stands, as is the one a device's
 * hang-up asks for: the server-controls guide asks one owner per action, so
 * the relay forwards no device's close and sends none of its own where an
 * exchange stands, and asks the exchange instead; a device whose socket
 * simply went, the platform cutting a function at its
 * limit or the network dropping, leaves the WebRTC session standing for the
 * device's own re-attach and settles detached, closing only the sideband; a
 * sideband that goes first leaves the usage unconfirmed and takes the device
 * socket with it.
 *
 * A side going is its stream ending, so the two endings are read where every
 * other frame is; the two waits are `Effect.sleep` forked into the same scope,
 * which is what ends them when the session does.
 */

export const RELAY_DEFAULTS = {
  /** How long the sideband is held for `session.closed` after `session.close` was sent, the docs' 15 seconds. */
  CLOSE_TIMEOUT_MS: 15_000,
} as const;

/** The reason a device socket is closed with when OpenAI's side ended before `session.closed`. */
const UPSTREAM_CLOSED_REASON = "upstream-closed";

/** The reason a device socket is closed with when it sent a frame the service does not admit. */
const UNPERMITTED_FRAME_REASON = "unpermitted-frame";

export interface RelayOptions<R = never> {
  device: VoiceSocket;
  upstream: VoiceSocket;
  /** Runs once, on the first `session.closed`; the relay waits for it before settling. */
  onSessionClosed?: ((closed: LiveSessionClosed) => Effect.Effect<void, never, R>) | undefined;
  /** Runs on every `session.usage.updated`, with the seconds it named, on a fiber of its own. */
  onUsageUpdated?: ((seconds: number) => Effect.Effect<void, never, R>) | undefined;
  /** Runs on every report the device sent in the service's vocabulary, which is read here and forwarded nowhere. */
  onDeviceReport?: ((report: SessionReportFrame) => void) | undefined;
  /** Runs on every avatar ask the device sent, read here and forwarded nowhere. */
  onAvatarRequest?: ((request: AvatarRequestFrame) => void) | undefined;
  /** Runs on the device's hang-up, before the close it asks for. */
  onHangUp?: (() => void) | undefined;
  /** Runs once, when a device frame is refused and the socket closed on it, with the frame's type as far as it could be read. */
  onFrameRefused?: ((type: string | undefined) => void) | undefined;
  /**
   * The session's one `session.close`, sent by the exchange that owns it and
   * waited on for `session.closed` under its own bound: asked once, at the
   * device's hang-up or at its going after a hang-up or a refusal. Absent
   * where no exchange stands, and then the relay sends the close itself.
   */
  closeSession?: Effect.Effect<void> | undefined;
  closeTimeoutMs?: number;
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
  const { device, upstream } = options;
  const closeTimeoutMs = options.closeTimeoutMs ?? RELAY_DEFAULTS.CLOSE_TIMEOUT_MS;

  return Effect.gen(function* () {
    const counts: RelayCounts = {
      framesToUpstream: 0,
      bytesToUpstream: 0,
      framesToDevice: 0,
      bytesToDevice: 0,
      droppedAudio: 0,
      reportsRead: 0,
      refusedUnpermitted: 0,
    };
    let closedSeen = false;
    /** Whether the device forwarded its own `session.close`: its going after that is a hang-up, not a drop. */
    let deviceAskedClose = false;
    /** Whether the device's socket was closed here on a refused frame: the session ends with it. */
    let refusedByPolicy = false;
    let closed: LiveSessionClosed | undefined;
    /** Whether the session's close was asked for, so it is asked once whoever asks. */
    let closeAsked = false;

    const settled = yield* Deferred.make<Finalization>();
    const settle = (finalization: Finalization): Effect.Effect<void> =>
      Effect.asVoid(Deferred.succeed(settled, finalization));

    const sendUpstream = (event: LiveClientEvent): Effect.Effect<void> =>
      Effect.flatMap(upstream.isOpen, (open) =>
        open ? upstream.send({ text: JSON.stringify(event) }) : Effect.void,
      );

    /**
     * The session's close, from its one owner: the exchange's own graceful
     * close where one stands, forked so the pipe keeps reading while it
     * waits, and the relay's own `session.close` where none does.
     */
    const askClose: Effect.Effect<void, never, Scope.Scope> = Effect.suspend(() => {
      if (closeAsked) return Effect.void;
      closeAsked = true;
      return options.closeSession === undefined
        ? sendUpstream(closeEvent(randomUUID()))
        : Effect.asVoid(Effect.forkScoped(options.closeSession));
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

    // Note that the frame handlers below stay untraced, because a span per
    // socket frame would open one on every audio chunk the relay passes.
    const onUpstreamFrame = Effect.fnUntraced(function* (frame: VoiceFrame) {
      const text = frameText(frame);
      const type = frameType(text);
      if (upstreamFrameDecision(type) === FRAME_DECISION.DROP_AUDIO) {
        counts.droppedAudio += 1;
      } else if (yield* device.isOpen) {
        yield* device.send(frame);
        counts.framesToDevice += 1;
        counts.bytesToDevice += frameBytes(frame);
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

    /**
     * A device frame the service does not admit closes the device's socket
     * with a policy violation rather than dropping the frame: an older
     * build's append, dropped silently, would leave the developer hearing
     * nothing and seeing nothing, and the close is what surfaces it. The
     * session itself ends the way a hang-up does, since the socket closing
     * is the device gone, and the graceful close upstream records its
     * seconds.
     */
    const refuse = Effect.fnUntraced(function* (type: string | undefined) {
      counts.refusedUnpermitted += 1;
      refusedByPolicy = true;
      options.onFrameRefused?.(type);
      if (yield* device.isOpen) {
        yield* device.close(SOCKET_CLOSE_CODE.POLICY_VIOLATION, UNPERMITTED_FRAME_REASON);
      }
    });

    const onDeviceFrame = Effect.fnUntraced(function* (frame: VoiceFrame) {
      const text = frameText(frame);
      const type = frameType(text);
      const decision = deviceFrameDecision(type);
      if (decision === FRAME_DECISION.REFUSE) {
        yield* refuse(type);
        return;
      }
      if (decision === FRAME_DECISION.HANG_UP) {
        // The caller has hung up here rather than when its socket goes.
        deviceAskedClose = true;
        options.onHangUp?.();
        yield* askClose;
        return;
      }
      if (decision === FRAME_DECISION.AVATAR) {
        const request = avatarRequestFrameFromWire(decodeLivePayload(text));
        if (request === undefined) {
          yield* refuse(type);
          return;
        }
        counts.reportsRead += 1;
        options.onAvatarRequest?.(request);
        return;
      }
      if (decision === FRAME_DECISION.REPORT) {
        // The one frame read past its type: a report in the service's own
        // vocabulary that is not one is a frame the service does not admit.
        const report = sessionReportFrameFromWire(decodeLivePayload(text));
        if (report === undefined) {
          yield* refuse(type);
          return;
        }
        counts.reportsRead += 1;
        options.onDeviceReport?.(report);
        return;
      }
      if (!(yield* upstream.isOpen)) return;
      yield* upstream.send(frame);
      counts.framesToUpstream += 1;
      counts.bytesToUpstream += frameBytes(frame);
    });

    /**
     * The device went first. A socket that went with
     * no hang-up and no refusal is a detach: the WebRTC session is the
     * device's and still stands, so nothing goes up and the relay settles at
     * once, leaving the device to attach a fresh sideband and the connection
     * that reads `session.closed` to record the seconds. Every other going is
     * the docs' graceful close on the device's behalf: `session.close` goes
     * up from the session's one owner, asked once however many hands asked,
     * and the sideband is held for the final event so the seconds are
     * recorded, under the timeout after which finalization is reported
     * incomplete.
     */
    const onDeviceGone = Effect.gen(function* () {
      if (closedSeen || (yield* Deferred.isDone(settled))) return;
      const detached = !deviceAskedClose && !refusedByPolicy;
      if (detached) {
        yield* settle(FINALIZATION.DETACHED);
        return;
      }
      if (!(yield* upstream.isOpen)) {
        yield* settle(FINALIZATION.UNCONFIRMED);
        return;
      }
      yield* askClose;
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
      Effect.andThen(Stream.runForEach(device.frames, onDeviceFrame), onDeviceGone),
    );

    const finalization = yield* Deferred.await(settled);
    if (yield* device.isOpen) {
      yield* finalization === FINALIZATION.CONFIRMED
        ? device.close(SOCKET_CLOSE_CODE.NORMAL)
        : device.close(SOCKET_CLOSE_CODE.GOING_AWAY, UPSTREAM_CLOSED_REASON);
    }
    if (yield* upstream.isOpen) yield* upstream.close(SOCKET_CLOSE_CODE.NORMAL);
    return { ...counts, finalization, seconds: closed?.usage.seconds };
  });
}
