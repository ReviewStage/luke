/**
 * web-terminal-socket.ts -- an agent shell's relay socket opened from this page: the seam the host's terminal concern attaches a shell through, on the page's own origin, under the session cookie the browser carries.
 *
 * The relay admits a page of the deployment's own origin by its cookie and
 * the `Origin` the browser names (`@luke/service`'s `http/relay-upgrade.ts`),
 * so the page opens the socket itself, as a plain same-origin `WebSocket`,
 * and sets no header: a page can set none on a socket, and the tab's
 * account is the cookie, which asks for none (`relay-credential.ts`). The
 * socket is the scope's, its listeners standing from the step that makes
 * it, so the scope's close closes it whether it opened or not. What
 * arrives is queued whole, binary frames as bytes and text frames as text,
 * and the close last. A browser hides why an upgrade was refused, so a
 * refusal reads as a socket that never opened, which the host waits out and
 * opens again (`compose-terminals.ts`). And a page's socket cannot stop
 * reading the network, so a pause holds what arrived in the page until the
 * resume, and the tab's pacing of what it draws holds all the same.
 */

import type {
  OpenTerminalSocket,
  TerminalSocketArrival,
  TerminalSocketOpening,
} from "@luke/host/effect";
import { type Cause, Effect, Latch, Queue, Stream } from "effect";

/** How the page ends a socket it no longer wants: normally, the shell going on in tmux. */
const NORMAL_CLOSE = 1000;

/** A message's frame: text as the relay sent it, or a binary frame's bytes, which a socket whose binary type is an array buffer hands as one. */
function arrivalOf(event: MessageEvent<string | ArrayBuffer>): TerminalSocketArrival {
  const { data } = event;
  return typeof data === "string" ? { text: data } : { bytes: new Uint8Array(data) };
}

export const openTerminalSocketFromPage: OpenTerminalSocket = (url) =>
  Effect.gen(function* () {
    const arrivals = yield* Queue.unbounded<TerminalSocketArrival, Cause.Done>();
    const flowing = yield* Latch.make(true);
    const socket = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const opened = new WebSocket(url);
        opened.binaryType = "arraybuffer";
        opened.addEventListener("message", (event) => {
          Queue.offerUnsafe(arrivals, arrivalOf(event));
        });
        opened.addEventListener("close", (event) => {
          Queue.offerUnsafe(arrivals, { close: event.code });
          Queue.endUnsafe(arrivals);
        });
        return opened;
      }),
      (opened) => Effect.sync(() => opened.close(NORMAL_CLOSE)),
    );
    return yield* Effect.callback<TerminalSocketOpening>((resume) => {
      let settled = false;
      const settle = (opening: TerminalSocketOpening) => {
        if (settled) return;
        settled = true;
        resume(Effect.succeed(opening));
      };
      socket.addEventListener(
        "open",
        () =>
          settle({
            socket: {
              arrivals: Stream.mapEffect(Stream.fromQueue(arrivals), (arrival) =>
                Effect.as(flowing.await, arrival),
              ),
              send: (frame) =>
                Effect.sync(() => {
                  if (socket.readyState !== WebSocket.OPEN) return;
                  // Note that the bytes are copied, because a socket sends only a view of a buffer of its own, never a shared one.
                  socket.send("bytes" in frame ? new Uint8Array(frame.bytes) : frame.text);
                }),
              pause: Effect.asVoid(flowing.close),
              resume: Effect.asVoid(flowing.open),
            },
          }),
        { once: true },
      );
      // An error is followed by the close, and a socket that closes before it opened never stood.
      socket.addEventListener("close", () => settle({ unreachable: true }), { once: true });
    });
  });
