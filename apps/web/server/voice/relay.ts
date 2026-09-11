import { randomUUID } from "node:crypto";
import type { RawData, WebSocket } from "ws";
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
  frameText,
  frameType,
  upstreamFrameDecision,
  type VoiceRoute,
} from "./frames.js";
import { FINALIZATION, type Finalization, type RelayCounts } from "./log.js";

/**
 * The pipe between one desktop socket and one OpenAI sideband, once both
 * stand. Frames cross as the bytes they arrived as; the service reads each
 * frame's `type` and nothing else of it, drops reflected audio by that type
 * on every route, and on the introduction route admits only what a
 * renderer's own data channel would carry. An opening command the service
 * sends of its own once `session.started` arrives follows the docs' order:
 * the command, then its acknowledgment or refusal matched by
 * `client_event_id` under a bounded wait, then whatever the service answers
 * that with; a caller who has hung up is sent none of it, whichever side of
 * the start they went. It ends the way the docs say a
 * session ends: `session.closed` is the finalization, reported once with the
 * seconds it named; a desktop that goes first has `session.close` sent on
 * its behalf and the sideband held open for the final event under a
 * timeout; a sideband that goes first leaves the usage unconfirmed and takes
 * the desktop socket with it.
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
 * is neither, so each is reported as itself rather than assumed.
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

/** The WebSocket close codes this service sends, by what each one says. */
export const SOCKET_CLOSE_CODE = {
  NORMAL: 1000,
  /** The service itself is leaving, or the upstream left first. */
  GOING_AWAY: 1001,
  /** The peer sent something this route does not admit, or was refused. */
  POLICY_VIOLATION: 1008,
} as const;

/** The reason a desktop socket is closed with when OpenAI's side ended before `session.closed`. */
export const UPSTREAM_CLOSED_REASON = "upstream-closed";

export interface RelayOptions {
  route: VoiceRoute;
  desktop: WebSocket;
  upstream: WebSocket;
  /** Runs once, on the first `session.closed`; the relay waits for it before settling. */
  onSessionClosed?: ((closed: LiveSessionClosed) => Promise<void>) | undefined;
  /** Runs on every `session.usage.updated`, with the seconds it named. */
  onUsageUpdated?: ((seconds: number) => void) | undefined;
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

function frameBytes(data: RawData): number {
  if (Buffer.isBuffer(data)) return data.byteLength;
  if (Array.isArray(data)) return data.reduce((total, part) => total + part.byteLength, 0);
  return data.byteLength;
}

function isOpen(socket: WebSocket): boolean {
  return socket.readyState === socket.OPEN;
}

/** Runs the pipe until the session is finalized or both transports are gone, and answers what it carried. */
export function relaySession(options: RelayOptions): Promise<RelaySummary> {
  const { route, desktop, upstream } = options;
  const closeTimeoutMs = options.closeTimeoutMs ?? RELAY_DEFAULTS.CLOSE_TIMEOUT_MS;
  const openingTimeoutMs = options.openingTimeoutMs ?? RELAY_DEFAULTS.OPENING_TIMEOUT_MS;
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
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  /** The `event_id` the opening command was sent with, until its acknowledgment settles it. */
  let openingEventId: string | undefined;
  let openingTimer: ReturnType<typeof setTimeout> | undefined;

  return new Promise<RelaySummary>((resolve) => {
    let settled = false;
    const settle = (finalization: Finalization): void => {
      if (settled) return;
      settled = true;
      if (closeTimer !== undefined) clearTimeout(closeTimer);
      openingEventId = undefined;
      if (openingTimer !== undefined) clearTimeout(openingTimer);
      if (isOpen(desktop)) {
        desktop.close(
          finalization === FINALIZATION.CONFIRMED
            ? SOCKET_CLOSE_CODE.NORMAL
            : SOCKET_CLOSE_CODE.GOING_AWAY,
          finalization === FINALIZATION.CONFIRMED ? undefined : UPSTREAM_CLOSED_REASON,
        );
      }
      if (isOpen(upstream)) upstream.close(SOCKET_CLOSE_CODE.NORMAL);
      resolve({ ...counts, finalization, seconds: closed?.usage.seconds });
    };

    const finalize = async (): Promise<void> => {
      if (closed !== undefined && options.onSessionClosed) {
        await options.onSessionClosed(closed).catch(() => undefined);
      }
      settle(FINALIZATION.CONFIRMED);
    };

    /**
     * The opening command's answer, handled once: the acknowledgment, the
     * refusal, or the wait running out. What the caller answers with goes up
     * in turn, which is how the docs' cue follows the greeting rather than
     * racing it.
     */
    const settleOpening = (opening: OpeningSettled): void => {
      if (openingEventId === undefined) return;
      openingEventId = undefined;
      if (openingTimer !== undefined) clearTimeout(openingTimer);
      const next = options.onOpeningSettled?.(opening);
      if (next !== undefined && isOpen(upstream)) upstream.send(JSON.stringify(next));
    };

    /** How a server event answers the opening command, or nothing when it is about something else. */
    const openingAnswer = (event: LiveServerEvent): OpeningSettled | undefined => {
      if (event.type === LIVE_SERVER_EVENT.ERROR) {
        const about = event.client_event_id ?? event.error.client_event_id;
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

    const onUpstreamMessage = (data: RawData, isBinary: boolean): void => {
      const text = frameText(data, isBinary);
      const type = frameType(text);
      const decision = upstreamFrameDecision(type, route);
      if (decision === FRAME_DECISION.DROP_AUDIO) {
        counts.droppedAudio += 1;
      } else if (decision === FRAME_DECISION.DROP_UNPERMITTED) {
        counts.droppedUnpermitted += 1;
      } else if (isOpen(desktop)) {
        desktop.send(data, { binary: isBinary });
        counts.framesToDesktop += 1;
        counts.bytesToDesktop += frameBytes(data);
      }
      if (type === LIVE_SERVER_EVENT.SESSION_STARTED && !startedSeen) {
        startedSeen = true;
        const opening = hungUp ? undefined : options.onSessionStarted?.();
        if (opening !== undefined && isOpen(upstream)) {
          upstream.send(JSON.stringify(opening));
          openingEventId = opening.event_id;
          openingTimer = setTimeout(() => {
            settleOpening({ outcome: OPENING_OUTCOME.UNACKNOWLEDGED });
          }, openingTimeoutMs);
        }
      }
      if (
        openingEventId !== undefined &&
        (type === LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED || type === LIVE_SERVER_EVENT.ERROR)
      ) {
        const event = parseLiveServerEvent(text);
        const answer = event === undefined ? undefined : openingAnswer(event);
        if (answer !== undefined) settleOpening(answer);
      }
      if (type === LIVE_SERVER_EVENT.USAGE_UPDATED && options.onUsageUpdated) {
        const updated = parseLiveServerEvent(text);
        if (updated?.type === LIVE_SERVER_EVENT.USAGE_UPDATED) {
          options.onUsageUpdated(updated.usage.seconds);
        }
      }
      if (type === LIVE_SERVER_EVENT.SESSION_CLOSED && !closedSeen) {
        closedSeen = true;
        const event = parseLiveServerEvent(text);
        if (event?.type === LIVE_SERVER_EVENT.SESSION_CLOSED) closed = event;
        void finalize();
      }
    };

    const onUpstreamGone = (): void => {
      if (!closedSeen) settle(FINALIZATION.UNCONFIRMED);
    };

    const onDesktopMessage = (data: RawData, isBinary: boolean): void => {
      const decision = desktopFrameDecision(frameType(frameText(data, isBinary)), route);
      if (decision !== FRAME_DECISION.FORWARD) {
        counts.droppedUnpermitted += 1;
        return;
      }
      if (!isOpen(upstream)) return;
      upstream.send(data, { binary: isBinary });
      counts.framesToUpstream += 1;
      counts.bytesToUpstream += frameBytes(data);
    };

    /**
     * The desktop went first. The docs' graceful close on its behalf: the
     * `session.closed` listener already stands, `session.close` goes up, and
     * the sideband is held for the final event so the seconds are recorded,
     * under the timeout after which finalization is reported incomplete.
     */
    const onDesktopGone = (): void => {
      hungUp = true;
      if (closedSeen || settled) return;
      // The caller has hung up, so the opening command will never be answered
      // to any purpose: it is settled as unanswered here rather than left
      // armed, where an acknowledgment arriving during the graceful close
      // would cue a session already on its way out.
      settleOpening({ outcome: OPENING_OUTCOME.UNACKNOWLEDGED });
      if (!isOpen(upstream)) {
        settle(FINALIZATION.UNCONFIRMED);
        return;
      }
      upstream.send(JSON.stringify(closeEvent(randomUUID())));
      closeTimer = setTimeout(() => {
        if (!closedSeen) settle(FINALIZATION.UNCONFIRMED);
      }, closeTimeoutMs);
    };

    upstream.on("message", onUpstreamMessage);
    upstream.on("close", onUpstreamGone);
    upstream.on("error", onUpstreamGone);
    desktop.on("message", onDesktopMessage);
    desktop.on("close", onDesktopGone);
    desktop.on("error", onDesktopGone);
    if (!isOpen(desktop)) onDesktopGone();
  });
}
