import { type Cause, Effect, Queue, Stream } from "effect";
import { type RawData, WebSocket } from "ws";
import type {
  OpenTerminalSocket,
  TerminalSocketArrival,
  TerminalSocketOpening,
} from "../compose-terminals.js";

/**
 * terminal-socket-over-ws.ts -- one shell's relay socket, opened over `ws`: the seam the terminal composer attaches a shell through.
 *
 * The socket is the scope's: it is made, and its listeners stand, in the one
 * synchronous step that acquires it, so nothing that arrives with the
 * handshake is heard by nobody, and the scope's close closes it, whether
 * the handshake answered or not. What arrives is queued whole, binary
 * frames as bytes and text frames as text, and the close last; the queue is
 * not bounded here because the composer pauses the socket itself once the
 * tab falls behind, and `ws` then stops reading from the network. An error's
 * words never travel, since a URL or header echoed in them could carry the
 * bearer.
 */

/** A frame's bytes as one array, whatever shape `ws` handed them in. */
function bytesOf(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
}

export const openTerminalSocketOverWs: OpenTerminalSocket = (url, headers) =>
  Effect.gen(function* () {
    const arrivals = yield* Queue.unbounded<TerminalSocketArrival, Cause.Done>();
    const socket = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const opened = new WebSocket(url, { headers: { ...headers } });
        opened.on("message", (data: RawData, isBinary: boolean) => {
          Queue.offerUnsafe(
            arrivals,
            isBinary ? { bytes: bytesOf(data) } : { text: data.toString() },
          );
        });
        opened.on("close", (code: number) => {
          Queue.offerUnsafe(arrivals, { close: code });
          Queue.endUnsafe(arrivals);
        });
        // A close follows every error, and it is the close that is read.
        opened.on("error", () => undefined);
        return opened;
      }),
      (opened) =>
        Effect.sync(() => {
          if (opened.readyState === WebSocket.OPEN) opened.close(1000);
          else opened.terminate();
        }),
    );
    return yield* Effect.callback<TerminalSocketOpening>((resume) => {
      let settled = false;
      const settle = (opening: TerminalSocketOpening) => {
        if (settled) return;
        settled = true;
        resume(Effect.succeed(opening));
      };
      socket.once("open", () =>
        settle({
          socket: {
            arrivals: Stream.fromQueue(arrivals),
            send: (frame) =>
              Effect.sync(() => {
                if (socket.readyState !== WebSocket.OPEN) return;
                if ("bytes" in frame) socket.send(frame.bytes, { binary: true });
                else socket.send(frame.text);
              }),
            pause: Effect.sync(() => socket.pause()),
            resume: Effect.sync(() => socket.resume()),
          },
        }),
      );
      socket.once("unexpected-response", (_request, response) => {
        settle({ refused: response.statusCode ?? 0 });
        socket.terminate();
      });
      socket.once("close", () => settle({ unreachable: true }));
      socket.once("error", () => settle({ unreachable: true }));
    });
  });
