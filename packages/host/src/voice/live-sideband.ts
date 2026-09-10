import {
  closeEvent,
  LIVE_SERVER_EVENT,
  type LiveServerEvent,
  type LiveSessionClosed,
} from "@sidecar/live";
import type { ScheduledTimer } from "@sidecar/runtime/vocabulary";
import {
  type LiveSideband,
  type LiveSocket,
  type OpenSocket,
  SOCKET_OPEN_FAULT,
  type SocketClose,
  type SocketOpening,
} from "@sidecar/voice";
import { type RawData, WebSocket } from "ws";

/**
 * The host's half of the trusted sideband: the socket seam `@sidecar/voice`'s
 * sources open their connections through, implemented here over `ws` so that
 * package stays free of it, and the graceful close the conversations guide
 * prescribes. What arrives on the socket is read by the source's own
 * `sidebandOverSocket`: every frame parsed with the Live grammar, the two
 * reflected audio events dropped by type before any listener sees them.
 */

/** How long a graceful close waits for `session.closed` before finalization is reported incomplete. */
export const SIDEBAND_CLOSE_TIMEOUT_MS = 15_000;

function socketOver(socket: WebSocket): LiveSocket {
  return {
    send: (data) => socket.send(data),
    close: () => socket.close(),
    onMessage: (listener) => {
      const handler = (data: RawData, isBinary: boolean) => {
        if (isBinary) return;
        listener(data.toString());
      };
      socket.on("message", handler);
      return () => {
        socket.off("message", handler);
      };
    },
    onClose: (listener) => {
      const handler = (code: number) => listener({ code });
      socket.on("close", handler);
      return () => {
        socket.off("close", handler);
      };
    },
  };
}

/**
 * Opens one WebSocket with the handshake headers it is handed, and settles
 * once the handshake has: with the socket, with the status a refused upgrade
 * answered, or with the name of the error a connection that never upgraded
 * ended in. The error's words never travel, since a URL or header echoed in
 * them could carry the bearer.
 */
export const openSocketOverWs: OpenSocket = (url, headers) =>
  new Promise<SocketOpening>((resolve) => {
    const socket = new WebSocket(url, { headers: { ...headers } });
    let settled = false;
    const settle = (opening: SocketOpening) => {
      if (settled) return;
      settled = true;
      resolve(opening);
    };
    socket.once("open", () => settle({ socket: socketOver(socket) }));
    socket.once("unexpected-response", (_request, response) => {
      settle({ fault: SOCKET_OPEN_FAULT.REFUSED, status: response.statusCode ?? 0 });
      socket.terminate();
    });
    socket.once("error", (error: Error) => {
      settle({ fault: SOCKET_OPEN_FAULT.NETWORK, errorName: error.name });
    });
    socket.once("close", () => {
      settle({ fault: SOCKET_OPEN_FAULT.NETWORK, errorName: "ClosedBeforeOpen" });
    });
  });

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
  schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel: (timer: ScheduledTimer) => void;
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
