import {
  closeEvent,
  LIVE_SERVER_EVENT,
  type LiveServerEvent,
  type LiveSessionClosed,
} from "@sidecar/live";
import type { LiveSideband, SocketClose } from "../live-socket.js";
import type { TimerHandle } from "./append-channel.js";

/**
 * The graceful close the conversations guide prescribes, over the sideband
 * seam alone: whoever holds the trusted side of a session ends it the same
 * way, so the desktop's host and the hosted voice service share this one
 * reading of `session.closed`.
 */

/** How long a graceful close waits for `session.closed` before finalization is reported incomplete. */
export const SIDEBAND_CLOSE_TIMEOUT_MS = 15_000;

export const SIDEBAND_CLOSE_OUTCOME = {
  /** `session.closed` arrived; its usage is final. */
  CLOSED: "closed",
  /** The socket ended before `session.closed`; final usage stays unconfirmed. */
  CONNECTION_LOST: "connection_lost",
  /** Nothing arrived inside the timeout; finalization is incomplete and the transport is released. */
  TIMED_OUT: "timed_out",
} as const;

export type SidebandCloseResult =
  | { outcome: typeof SIDEBAND_CLOSE_OUTCOME.CLOSED; closed: LiveSessionClosed }
  | { outcome: typeof SIDEBAND_CLOSE_OUTCOME.CONNECTION_LOST; close: SocketClose }
  | { outcome: typeof SIDEBAND_CLOSE_OUTCOME.TIMED_OUT };

export interface GracefulCloseOptions {
  eventId: string;
  schedule: (callback: () => void, delayMs: number) => TimerHandle;
  cancel: (timer: TimerHandle) => void;
  timeoutMs?: number;
}

/**
 * Closes a session the way the guide says to: the `session.closed` listener
 * is registered first, then `session.close` is sent, and the sideband is held
 * open until the final event, the socket's own end, or the timeout. The
 * transport is released only after one of those; a socket closed first would
 * leave the final usage unconfirmed by the caller's own hand.
 */
export function closeGracefully(
  sideband: LiveSideband,
  options: GracefulCloseOptions,
): Promise<SidebandCloseResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: SidebandCloseResult) => {
      if (settled) return;
      settled = true;
      options.cancel(timer);
      stopEvents();
      stopClose();
      sideband.close();
      resolve(result);
    };
    const stopEvents = sideband.onEvent((event: LiveServerEvent) => {
      if (event.type === LIVE_SERVER_EVENT.SESSION_CLOSED) {
        finish({ outcome: SIDEBAND_CLOSE_OUTCOME.CLOSED, closed: event });
      }
    });
    const stopClose = sideband.onClose((close) =>
      finish({ outcome: SIDEBAND_CLOSE_OUTCOME.CONNECTION_LOST, close }),
    );
    const timer = options.schedule(
      () => finish({ outcome: SIDEBAND_CLOSE_OUTCOME.TIMED_OUT }),
      options.timeoutMs ?? SIDEBAND_CLOSE_TIMEOUT_MS,
    );
    sideband.send(closeEvent(options.eventId));
  });
}
