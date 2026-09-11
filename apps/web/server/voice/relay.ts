import { randomUUID } from "node:crypto";
import type { RawData, WebSocket } from "ws";
import {
  closeEvent,
  LIVE_SERVER_EVENT,
  type LiveClientEvent,
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
 * renderer's own data channel would carry. It ends the way the docs say a
 * session ends: `session.closed` is the finalization, reported once with the
 * seconds it named; a desktop that goes first has `session.close` sent on
 * its behalf and the sideband held open for the final event under a
 * timeout; a sideband that goes first leaves the usage unconfirmed and takes
 * the desktop socket with it.
 */

export const RELAY_DEFAULTS = {
  /** How long the sideband is held for `session.closed` after `session.close` was sent, the docs' 15 seconds. */
  CLOSE_TIMEOUT_MS: 15_000,
} as const;

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
  closeTimeoutMs?: number;
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
  let closed: LiveSessionClosed | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  return new Promise<RelaySummary>((resolve) => {
    let settled = false;
    const settle = (finalization: Finalization): void => {
      if (settled) return;
      settled = true;
      if (closeTimer !== undefined) clearTimeout(closeTimer);
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
        const opening = options.onSessionStarted?.();
        if (opening !== undefined && isOpen(upstream)) upstream.send(JSON.stringify(opening));
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
      if (closedSeen || settled) return;
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
