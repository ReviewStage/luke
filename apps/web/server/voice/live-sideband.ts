import {
  type LiveSideband,
  type LiveSocket,
  sidebandOverSocket,
} from "@sidecar/voice/live-session";
import type { RawData, WebSocket } from "ws";
import type { LiveServerEvent } from "../live.js";
import { SOCKET_CLOSE_CODE } from "./relay.js";

/**
 * The service's half of the trusted sideband: the socket the upstream
 * attached to a session, read as the `LiveSideband` the live session service
 * consumes. `@sidecar/voice` names no socket library — its sources open
 * connections through an injected seam — so the `ws` binding lives here,
 * where the relay already reaches it, and the web reaches that package only
 * through its live-session door, never the barrel, so nothing the package
 * later adds behind the barrel can enter a function bundle from here. What arrives is parsed with the Live
 * grammar by the package's own `sidebandOverSocket`, which drops the two
 * reflected audio events by type before any listener sees them and holds
 * what the session says before anyone listens.
 */

function socketOver(socket: WebSocket): LiveSocket {
  return {
    send: (data) => socket.send(data),
    close: () => socket.close(SOCKET_CLOSE_CODE.NORMAL),
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

export function upstreamSideband(socket: WebSocket): LiveSideband {
  return sidebandOverSocket(socketOver(socket));
}

/**
 * A sideband whose every event is observed once before any listener reads
 * it: the record's writer sees the stream in the one order the session
 * emitted it, however many listeners the service and its graceful close
 * register, and the replay of what the session said before anyone listened
 * is kept, because the inner sideband is subscribed only when the first
 * listener arrives. A listener that leaves stops hearing; the observation
 * stands for the session.
 */
export function observedSideband(
  sideband: LiveSideband,
  observe: (event: LiveServerEvent) => void,
): LiveSideband {
  const listeners = new Set<(event: LiveServerEvent) => void>();
  let subscribed = false;
  return {
    onEvent: (listener) => {
      listeners.add(listener);
      if (!subscribed) {
        subscribed = true;
        sideband.onEvent((event) => {
          observe(event);
          for (const standing of [...listeners]) standing(event);
        });
      }
      return () => {
        listeners.delete(listener);
      };
    },
    onClose: (listener) => sideband.onClose(listener),
    send: (event) => sideband.send(event),
    close: () => sideband.close(),
  };
}
