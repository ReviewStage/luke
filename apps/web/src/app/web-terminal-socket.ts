/**
 * web-terminal-socket.ts -- an agent shell's relay socket opened from this page: the seam the host's terminal concern attaches a shell through, on the page's own origin, under the session cookie the browser carries.
 *
 * The relay admits a page of the deployment's own origin by its cookie and
 * the `Origin` the browser names (`@luke/service`'s `http/relay-upgrade.ts`),
 * so the page opens the socket itself, as a plain same-origin `WebSocket`,
 * and sets no header: a page can set none on a socket, and the tab's
 * account is the cookie, which asks for none (`relay-credential.ts`). The
 * socket is the scope's, so the scope's close closes it whether it opened or
 * not, and one that opened or closed before the host listened is read as it
 * stands. What arrives is queued whole, binary frames as bytes and text
 * frames as text, and the close last. A browser hides why an upgrade was
 * refused, so a refusal reads as a socket that never opened, which the host
 * waits out and opens again (`compose-terminals.ts`). A page's socket cannot
 * stop reading the network, so a pause holds what arrives in the page until
 * the resume, up to a bound past which the page lets the socket go, as a
 * screen that has stopped drawing, a hidden tab's, would otherwise hold a
 * chatty shell's output without end; the host's reconnect then redraws the
 * shell, which tmux kept.
 */

import type {
  OpenTerminalSocket,
  TerminalSocketArrival,
  TerminalSocketOpening,
} from "@luke/host/effect";
import { type Cause, Effect, Latch, Queue, Stream } from "effect";

/** How the page ends a socket it no longer wants: normally, the shell going on in tmux. */
const NORMAL_CLOSE = 1000;

/**
 * The most bytes of output the page holds for the host before it lets the
 * socket go: forty times the screen's own pause watermark
 * (`TERMINAL_FLOW.PAUSE_ABOVE_BYTES`), which a host still reading never
 * comes near.
 */
const HELD_MAX_BYTES = 4 * 1024 * 1024;

/** An open socket, as the host holds one. */
type PageSocket = Extract<TerminalSocketOpening, { readonly socket: unknown }>["socket"];

/** A message's frame: text as the relay sent it, or a binary frame's bytes, which a socket whose binary type is an array buffer hands as one. */
function arrivalOf(event: MessageEvent<string | ArrayBuffer>): TerminalSocketArrival {
  const { data } = event;
  return typeof data === "string" ? { text: data } : { bytes: new Uint8Array(data) };
}

/** The bytes an arrival carries toward the bound: a binary frame's, and nothing for text or the close. */
function heldBytes(arrival: TerminalSocketArrival): number {
  return "bytes" in arrival ? arrival.bytes.length : 0;
}

export const openTerminalSocketFromPage: OpenTerminalSocket = (url) =>
  Effect.gen(function* () {
    const arrivals = yield* Queue.unbounded<TerminalSocketArrival, Cause.Done>();
    const flowing = yield* Latch.make(true);
    // The output that arrived and the host has not taken yet.
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
          // Note that the bytes are copied, because a socket sends only a view of a buffer of its own, never a shared one.
          socket.send("bytes" in frame ? new Uint8Array(frame.bytes) : frame.text);
        }),
      pause: Effect.asVoid(flowing.close),
      resume: Effect.asVoid(flowing.open),
    };
    return yield* Effect.callback<TerminalSocketOpening>((resume) => {
      // Note that a socket that opened or closed before this listened is read as it stands, because its event will not come again.
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
      // An error is followed by the close, and a socket that closes before it opened never stood.
      socket.addEventListener("close", () => settle({ unreachable: true }), { once: true });
    });
  });
