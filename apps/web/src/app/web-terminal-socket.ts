import type {
  OpenTerminalSocket,
  TerminalSocketArrival,
  TerminalSocketOpening,
} from "@repo/host/effect";
import { type Cause, Effect, Latch, Queue, Stream } from "effect";

const NORMAL_CLOSE = 1000;

const HELD_MAX_BYTES = 4 * 1024 * 1024;

type PageSocket = Extract<TerminalSocketOpening, { readonly socket: unknown }>["socket"];

function arrivalOf(event: MessageEvent<string | ArrayBuffer>): TerminalSocketArrival {
  const { data } = event;
  return typeof data === "string" ? { text: data } : { bytes: new Uint8Array(data) };
}

function heldBytes(arrival: TerminalSocketArrival): number {
  return "bytes" in arrival ? arrival.bytes.length : 0;
}

export const openTerminalSocketFromPage: OpenTerminalSocket = (url) =>
  Effect.gen(function* () {
    const arrivals = yield* Queue.unbounded<TerminalSocketArrival, Cause.Done>();
    const flowing = yield* Latch.make(true);
    let held = 0;
    const socket = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const opened = new WebSocket(url);
        opened.binaryType = "arraybuffer";
        opened.addEventListener("message", (event) => {
          const arrival = arrivalOf(event);
          held += heldBytes(arrival);
          Queue.offerUnsafe(arrivals, arrival);
          if (held > HELD_MAX_BYTES && opened.readyState === WebSocket.OPEN) {
            opened.close(NORMAL_CLOSE);
          }
        });
        opened.addEventListener("close", (event) => {
          Queue.offerUnsafe(arrivals, { close: event.code });
          Queue.endUnsafe(arrivals);
        });
        return opened;
      }),
      (opened) => Effect.sync(() => opened.close(NORMAL_CLOSE)),
    );
    const open: PageSocket = {
      arrivals: Stream.mapEffect(Stream.fromQueue(arrivals), (arrival) =>
        Effect.map(flowing.await, () => {
          held -= heldBytes(arrival);
          return arrival;
        }),
      ),
      send: (frame) =>
        Effect.sync(() => {
          if (socket.readyState !== WebSocket.OPEN) return;
          socket.send("bytes" in frame ? new Uint8Array(frame.bytes) : frame.text);
        }),
      pause: Effect.asVoid(flowing.close),
      resume: Effect.asVoid(flowing.open),
    };
    return yield* Effect.callback<TerminalSocketOpening>((resume) => {
      if (socket.readyState === WebSocket.OPEN) {
        resume(Effect.succeed({ socket: open }));
        return;
      }
      if (socket.readyState === WebSocket.CLOSED) {
        resume(Effect.succeed({ unreachable: true }));
        return;
      }
      let settled = false;
      const settle = (opening: TerminalSocketOpening) => {
        if (settled) return;
        settled = true;
        resume(Effect.succeed(opening));
      };
      socket.addEventListener("open", () => settle({ socket: open }), { once: true });
      socket.addEventListener("close", () => settle({ unreachable: true }), { once: true });
    });
  });
