import { holdSocket, type OpenSocket, SOCKET_OPEN_FAULT, type SocketOpening } from "@sidecar/voice";
import { Effect } from "effect";
import { type RawData, WebSocket } from "ws";

/** The protocol's own ceiling on a close reason, in bytes; what is handed up is never longer. */
const CLOSE_REASON_MAX_BYTES = 123;

/**
 * The host's half of the trusted sideband: the socket seam `@sidecar/voice`'s
 * sources open their connections through, implemented here over `ws` so that
 * package stays free of it. What arrives on the socket is read by the
 * source's own `sidebandOverSocket`: every frame parsed with the Live
 * grammar, the two reflected audio events dropped by type before any
 * consumer sees them.
 */

/** A close frame's reason as text, cut to the protocol's ceiling; nothing where the frame carried none. */
function closeReason(reason: Buffer): string | undefined {
  if (reason.length === 0) return undefined;
  return reason.subarray(0, CLOSE_REASON_MAX_BYTES).toString("utf8");
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
 *
 * The hold and the hand that fills it stand in the same turn the socket is
 * constructed in, before anything could arrive: `ws` re-queues the bytes that
 * followed the handshake response and flushes them on the next tick, ahead of
 * any fiber a consumer could fork for them, so a frame in that same chunk
 * would otherwise be emitted to nobody. Nothing here waits on a fiber to
 * begin listening, which is why the hold is a hand and not a stream of its
 * own.
 */
export const openSocketOverWs: OpenSocket = (url, headers) =>
  Effect.callback<SocketOpening>((resume) => {
    const socket = new WebSocket(url, { headers: { ...headers } });
    const hold = holdSocket({
      send: (data) => socket.send(data),
      // Note that a ping on a socket still connecting or already closing is dropped, because `ws`
      // throws on one and a heartbeat that outlives its socket by a beat is no fault.
      ping: () => {
        if (socket.readyState === WebSocket.OPEN) socket.ping();
      },
      close: () => socket.close(),
    });
    let settled = false;
    const settle = (opening: SocketOpening) => {
      if (settled) return;
      settled = true;
      resume(Effect.succeed(opening));
    };
    socket.on("message", (data: RawData, isBinary: boolean) => {
      if (isBinary) return;
      hold.hear({ frame: data.toString() });
    });
    socket.on("close", (code: number, reason: Buffer) => {
      settle({ fault: SOCKET_OPEN_FAULT.NETWORK, errorName: "ClosedBeforeOpen" });
      const text = closeReason(reason);
      hold.hear({ close: text === undefined ? { code } : { code, reason: text } });
    });
    socket.once("open", () => settle({ socket: hold.socket }));
    socket.once("unexpected-response", (_request, response) => {
      settle({ fault: SOCKET_OPEN_FAULT.REFUSED, status: response.statusCode ?? 0 });
      socket.terminate();
    });
    socket.once("error", (error: Error) => {
      settle({ fault: SOCKET_OPEN_FAULT.NETWORK, errorName: error.name });
    });
    return Effect.sync(() => {
      if (settled) return;
      settled = true;
      socket.terminate();
    });
  });
