// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { TerminalSocketArrival } from "@luke/host/effect";
import { Effect, Exit, Fiber, Scope, Stream } from "effect";
import { afterEach, vi } from "vitest";
import { openTerminalSocketFromPage } from "../src/app/web-terminal-socket";

/**
 * An agent shell's relay socket as this page opens it: at the address the
 * host names, with no subprotocol and no header of the page's own, so the
 * browser carries the session cookie and the page's origin itself; binary
 * frames handed up as bytes and text frames as text, the close last; a
 * socket that closes before it opens read as one that never stood, as a
 * browser hides a refused upgrade's status; what the host sends going out
 * as bytes or text; a pause holding what arrived until the resume; and the
 * scope's close closing the socket. A stand-in WebSocket, which jsdom
 * opens nothing with.
 */

const ADDRESS = "ws://localhost:3000/api/terminal/sessions?agent=a&terminal=t&cols=120&rows=32";

/** A WebSocket the test opens, feeds, and closes by hand, keeping what was sent on it and how it was made. */
class StandInSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static opened: StandInSocket[] = [];
  readyState = StandInSocket.CONNECTING;
  binaryType = "blob";
  readonly sent: (string | Uint8Array)[] = [];
  closedWith: number | undefined;
  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    super();
    StandInSocket.opened.push(this);
  }
  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }
  close(code?: number): void {
    this.closedWith = code;
    this.readyState = StandInSocket.CLOSED;
  }
  /** The relay accepting the upgrade. */
  accept(): void {
    this.readyState = StandInSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }
  /** One frame from the relay. */
  receive(data: string | ArrayBuffer): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
  /** The socket ending, with the code the relay closed it with or the browser's own. */
  end(code: number): void {
    this.readyState = StandInSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code }));
  }
}

/** The one socket the seam made. */
function standIn(): StandInSocket {
  const [socket] = StandInSocket.opened;
  assert.ok(socket, "the seam opened no socket");
  return socket;
}

/** The bytes of a binary frame, as the relay sends them. */
const frame = (text: string) => new TextEncoder().encode(text).buffer;

/** What a frame carries, its bytes read as the text they hold, so bytes made in either of jsdom's realms compare alike. */
type Readable = { readonly bytes: string } | { readonly text: string } | { readonly close: number };

function readable(sent: TerminalSocketArrival | string | Uint8Array): Readable {
  if (typeof sent === "string") return { text: sent };
  if (ArrayBuffer.isView(sent)) return { bytes: new TextDecoder().decode(sent) };
  if ("bytes" in sent) return { bytes: new TextDecoder().decode(sent.bytes) };
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
  StandInSocket.opened = [];
});

it.effect(
  "the socket opens at the host's address with nothing of the page's own, and hands up binary frames as bytes, text as text, and the close last",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        vi.stubGlobal("WebSocket", StandInSocket);
        const opening = yield* Effect.forkChild(
          openTerminalSocketFromPage(ADDRESS, { authorization: "Bearer never-sent" }),
        );
        yield* Effect.yieldNow;
        const socket = standIn();
        assert.equal(socket.url, ADDRESS);
        assert.equal(socket.protocols, undefined, "no subprotocol carries anything");
        assert.equal(socket.binaryType, "arraybuffer");

        socket.accept();
        const opened = yield* Fiber.join(opening);
        assert.ok("socket" in opened);
        socket.receive(frame("README.md\r\n"));
        socket.receive('{"type":"attached"}');
        socket.end(4000);

        const arrivals = yield* Stream.runCollect(opened.socket.arrivals);
        assert.deepEqual([...arrivals].map(readable), [
          { bytes: "README.md\r\n" },
          { text: '{"type":"attached"}' },
          { close: 4000 },
        ]);
      }),
    ),
);

it.effect(
  "a socket that closes before it opens never stood, whatever refused it, and the scope's close closes one that never opened",
  () =>
    Effect.gen(function* () {
      vi.stubGlobal("WebSocket", StandInSocket);
      const scope = yield* Scope.make();
      const opening = yield* Effect.forkChild(
        Scope.provide(openTerminalSocketFromPage(ADDRESS, {}), scope),
      );
      yield* Effect.yieldNow;
      const socket = standIn();

      socket.end(1006);
      assert.deepEqual(yield* Fiber.join(opening), { unreachable: true });

      const waiting = yield* Scope.make();
      yield* Effect.forkChild(Scope.provide(openTerminalSocketFromPage(ADDRESS, {}), waiting));
      yield* Effect.yieldNow;
      const unopened = StandInSocket.opened[1];
      assert.ok(unopened);
      yield* Scope.close(waiting, Exit.void);
      assert.equal(unopened.closedWith, 1000, "the page lets go of a socket still opening");
      yield* Scope.close(scope, Exit.void);
    }),
);

it.effect(
  "what the host sends goes out as binary bytes or as text, nothing once the socket closed, and the scope's close closes it",
  () =>
    Effect.gen(function* () {
      vi.stubGlobal("WebSocket", StandInSocket);
      const scope = yield* Scope.make();
      const opening = yield* Effect.forkChild(
        Scope.provide(openTerminalSocketFromPage(ADDRESS, {}), scope),
      );
      yield* Effect.yieldNow;
      const socket = standIn();
      socket.accept();
      const opened = yield* Fiber.join(opening);
      assert.ok("socket" in opened);

      yield* opened.socket.send({ bytes: new TextEncoder().encode("ls\r") });
      yield* opened.socket.send({ text: '{"type":"resize","cols":80,"rows":24}' });
      yield* Scope.close(scope, Exit.void);
      yield* opened.socket.send({ bytes: new TextEncoder().encode("late") });

      assert.deepEqual(socket.sent.map(readable), [
        { bytes: "ls\r" },
        { text: '{"type":"resize","cols":80,"rows":24}' },
      ]);
      assert.equal(socket.closedWith, 1000);
    }),
);

it.effect("a pause holds what arrived in the page until the resume, in the order it came", () =>
  Effect.scoped(
    Effect.gen(function* () {
      vi.stubGlobal("WebSocket", StandInSocket);
      const opening = yield* Effect.forkChild(openTerminalSocketFromPage(ADDRESS, {}));
      yield* Effect.yieldNow;
      const socket = standIn();
      socket.accept();
      const opened = yield* Fiber.join(opening);
      assert.ok("socket" in opened);
      const heard: TerminalSocketArrival[] = [];
      yield* Effect.forkChild(
        Stream.runForEach(opened.socket.arrivals, (arrival) =>
          Effect.sync(() => void heard.push(arrival)),
        ),
      );

      yield* opened.socket.pause;
      socket.receive(frame("one"));
      socket.receive(frame("two"));
      for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
      const whilePaused = heard.length;
      yield* opened.socket.resume;
      socket.end(4003);
      for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;

      assert.equal(whilePaused, 0, "nothing is handed up while paused");
      assert.deepEqual(heard.map(readable), [{ bytes: "one" }, { bytes: "two" }, { close: 4003 }]);
    }),
  ),
);
