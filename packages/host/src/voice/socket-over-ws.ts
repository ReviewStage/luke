import {
  holdSocket,
  type LiveSocket,
  type OpenSocket,
  SOCKET_OPEN_FAULT,
  type SocketOpening,
} from "@sidecar/voice";
import { Effect } from "effect";
import { type RawData, WebSocket } from "ws";

/**
 * The host's half of the trusted sideband: the socket seam `@sidecar/voice`'s
 * sources open their connections through, implemented here over `ws` so that
 * package stays free of it. What arrives on the socket is read by the
 * source's own `sidebandOverSocket`: every frame parsed with the Live
 * grammar, the two reflected audio events dropped by type before any
 * listener sees them.
 */

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
 * Opens one WebSocket with the handshake headers it is handed, and answers
 * once the handshake has: with the socket, with the status a refused upgrade
 * answered, or with the name of the error a connection that never upgraded
 * ended in. The error's words never travel, since a URL or header echoed in
 * them could carry the bearer.
 *
 * The handshake is what the effect acquires and giving it up is its release:
 * a fiber interrupted before the handshake answered terminates the socket it
 * started, so a hang-up during an open leaves nothing connecting behind it.
 * A handshake that did answer belongs to the caller from then on, and closing
 * it is the caller's to do.
 */
export const openSocketOverWs: OpenSocket = (url, headers) =>
  Effect.async<SocketOpening>((resume) => {
    const socket = new WebSocket(url, { headers: { ...headers } });
    let settled = false;
    const settle = (opening: SocketOpening) => {
      if (settled) return;
      settled = true;
      resume(Effect.succeed(opening));
    };
    // Held here, inside the open handler and not in the caller's continuation: `ws` re-queues the
    // bytes that followed the handshake response and flushes them on the next tick, which runs
    // before any continuation of this effect, so a frame in that same chunk would otherwise be
    // emitted to no listener. The hold's listener stands before this handler returns.
    socket.once("open", () => settle({ socket: holdSocket(socketOver(socket)) }));
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
    return Effect.sync(() => {
      if (settled) return;
      settled = true;
      socket.terminate();
    });
  });
