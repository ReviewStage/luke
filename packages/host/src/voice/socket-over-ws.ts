import {
  type LiveSocket,
  type OpenSocket,
  SOCKET_OPEN_FAULT,
  type SocketOpening,
} from "@sidecar/voice";
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
