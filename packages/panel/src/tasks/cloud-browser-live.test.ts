import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  BROWSER_LIVE_CLIENT,
  BROWSER_LIVE_CLOSE_CODE,
  BROWSER_LIVE_CLOSE_REASON,
  BROWSER_LIVE_KEY_ACTION,
  BROWSER_LIVE_SERVER,
} from "@luke/features/browser-live-wire";
import { Effect, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import {
  type BrowserLiveListener,
  CLOUD_BROWSER_PHASE,
  type CloudBrowserFrame,
  type CloudBrowserView,
  cloudBrowserLive,
  type InputMessage,
} from "./cloud-browser-live.js";

/**
 * One cloud Browser tab's live view over a fake door: the sockets it opens,
 * what it sends on each, and the frames it hands the pane, as the relay
 * answers it in each test. A synthetic task and tab throughout; the clock is
 * the test's own.
 */

const TARGET = {
  taskId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  tabId: "5a0e1f2b-3c4d-4e5f-9a6b-7c8d9e0f1a2b",
} as const;

const VIEWPORT = { width: 640, height: 400 } as const;

const KEY: InputMessage = {
  type: BROWSER_LIVE_CLIENT.KEY,
  action: BROWSER_LIVE_KEY_ACTION.DOWN,
  key: "a",
  code: "KeyA",
  keyCode: 65,
  modifiers: 0,
};

/** One socket the view opened: what it sent, decoded, and the listener the relay answers through. */
interface FakeSocket {
  readonly sent: unknown[];
  readonly listener: BrowserLiveListener;
  closed: boolean;
}

/** A view over a door that records every socket, its frames drawn into `frames`, and its states into `views`. */
function harness() {
  const sockets: FakeSocket[] = [];
  const frames: CloudBrowserFrame[] = [];
  const views: CloudBrowserView[] = [];
  const live = cloudBrowserLive({
    open: (target, listener) => {
      assert.deepEqual(target, TARGET);
      const socket: FakeSocket = { sent: [], listener, closed: false };
      sockets.push(socket);
      return {
        send: (text) => socket.sent.push(JSON.parse(text)),
        close: () => {
          socket.closed = true;
        },
      };
    },
    target: TARGET,
    viewport: () => VIEWPORT,
    onFrame: (frame) => frames.push(frame),
  });
  const say = (socket: FakeSocket | undefined, message: object) =>
    Effect.sync(() => socket?.listener.message(JSON.stringify(message)));
  const run = Effect.forkChild(
    Stream.runForEach(live.views, (view) => Effect.sync(() => views.push(view))),
  );
  return { live, sockets, frames, views, say, run, last: () => views.at(-1) };
}

/** Lets every fiber the view forked run as far as it can. */
const settle = Effect.repeat(Effect.yieldNow, { times: 20 });

const VIEWPORT_MESSAGE = { type: BROWSER_LIVE_CLIENT.VIEWPORT, ...VIEWPORT };

const WATCHING_MESSAGE = { type: BROWSER_LIVE_CLIENT.WATCHING };

it.effect(
  "a frame is drawn once the socket opens, the viewport is sent as it opens, and watching is said each minute rather than the viewport again",
  () =>
    Effect.gen(function* () {
      const view = harness();
      const fiber = yield* view.run;
      yield* settle;
      const [socket] = view.sockets;
      assert.ok(socket, "one socket opened");
      assert.deepEqual(socket.sent, [VIEWPORT_MESSAGE]);
      assert.equal(view.last()?.painted, false);

      yield* view.say(socket, {
        type: BROWSER_LIVE_SERVER.FRAME,
        data: "/9j/AA==",
        pageWidth: 1280,
        pageHeight: 800,
      });
      yield* settle;
      assert.deepEqual(view.frames, [{ data: "/9j/AA==", pageWidth: 1280, pageHeight: 800 }]);
      assert.equal(view.last()?.phase, CLOUD_BROWSER_PHASE.LIVE);
      assert.equal(view.last()?.painted, true);

      yield* TestClock.adjust("2 minutes");
      assert.deepEqual(socket.sent, [VIEWPORT_MESSAGE, WATCHING_MESSAGE, WATCHING_MESSAGE]);
      yield* Fiber.interrupt(fiber);
      assert.equal(socket.closed, true);
    }),
);

it.effect(
  "taking over and handing back go on the socket, and input is sent only while the member drives",
  () =>
    Effect.gen(function* () {
      const view = harness();
      const fiber = yield* view.run;
      yield* settle;
      const [socket] = view.sockets;
      assert.ok(socket);
      yield* view.say(socket, { type: BROWSER_LIVE_SERVER.DRIVER, driver: null, yours: false });
      yield* settle;

      view.live.input(KEY);
      view.live.takeOver();
      yield* view.say(socket, {
        type: BROWSER_LIVE_SERVER.DRIVER,
        driver: { userId: "user-dean", heldUntil: 60_000 },
        yours: true,
      });
      yield* settle;
      view.live.input(KEY);
      view.live.handBack();
      yield* view.say(socket, { type: BROWSER_LIVE_SERVER.DRIVER, driver: null, yours: false });
      yield* settle;
      view.live.input(KEY);

      assert.deepEqual(socket.sent, [
        VIEWPORT_MESSAGE,
        { type: BROWSER_LIVE_CLIENT.TAKE_OVER },
        KEY,
        { type: BROWSER_LIVE_CLIENT.HAND_BACK },
      ]);
      yield* Fiber.interrupt(fiber);
    }),
);

it.effect(
  "a socket that drops after it was heard on opens again after a wait, and sizes the new one",
  () =>
    Effect.gen(function* () {
      const view = harness();
      const fiber = yield* view.run;
      yield* settle;
      const [first] = view.sockets;
      yield* view.say(first, { type: BROWSER_LIVE_SERVER.DRIVER, driver: null, yours: false });
      yield* Effect.sync(() => first?.listener.closed(1006));
      yield* settle;
      assert.equal(view.last()?.phase, CLOUD_BROWSER_PHASE.RECONNECTING);
      assert.equal(view.sockets.length, 1);

      yield* TestClock.adjust("1 second");
      assert.equal(view.sockets.length, 2);
      assert.deepEqual(view.sockets[1]?.sent, [VIEWPORT_MESSAGE]);
      yield* Fiber.interrupt(fiber);
    }),
);

it.effect("a socket that never opens is asked again on a wait that doubles", () =>
  Effect.gen(function* () {
    const view = harness();
    const fiber = yield* view.run;
    yield* settle;
    yield* Effect.sync(() => view.sockets[0]?.listener.closed(1006));
    yield* TestClock.adjust("1 second");
    assert.equal(view.sockets.length, 2);
    yield* Effect.sync(() => view.sockets[1]?.listener.closed(1006));
    yield* TestClock.adjust("1 second");
    assert.equal(view.sockets.length, 2, "the second wait is longer than the first");
    yield* TestClock.adjust("1 second");
    assert.equal(view.sockets.length, 3);
    yield* Fiber.interrupt(fiber);
  }),
);

it.effect(
  "a socket the relay closed as idle stays closed, saying why, until a new view opens it",
  () =>
    Effect.gen(function* () {
      const view = harness();
      const fiber = yield* view.run;
      yield* settle;
      const [socket] = view.sockets;
      yield* view.say(socket, {
        type: BROWSER_LIVE_SERVER.CLOSED,
        reason: BROWSER_LIVE_CLOSE_REASON.IDLE,
      });
      yield* Effect.sync(() =>
        socket?.listener.closed(BROWSER_LIVE_CLOSE_CODE[BROWSER_LIVE_CLOSE_REASON.IDLE]),
      );
      yield* settle;
      assert.equal(view.last()?.phase, CLOUD_BROWSER_PHASE.ENDED);
      assert.equal(view.last()?.ended, BROWSER_LIVE_CLOSE_REASON.IDLE);

      yield* TestClock.adjust("5 minutes");
      assert.equal(view.sockets.length, 1);
      yield* Fiber.interrupt(fiber);
    }),
);
