import { type Cause, Effect, Queue, Stream } from "effect";
import { type RawData, WebSocket } from "ws";
import type {
  OpenTerminalSocket,
  TerminalSocketArrival,
  TerminalSocketOpening,
} from "../compose-terminals.js";

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
