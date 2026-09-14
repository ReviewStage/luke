import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, Stream } from "effect";
import { test } from "vitest";
import { HELD_SOCKET, holdSocket } from "./held-socket.js";
import type { LiveSocket, SocketArrival, SocketVerbs } from "./live-socket.js";

/** The transport a hold stands over: what the trusted side sent, and whether it hung up. */
class FakeTransport implements SocketVerbs {
  readonly sent: string[] = [];
  closedByClient = false;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closedByClient = true;
  }
}

/** Lets the fibers reading a hold's stream take what has been offered to them. */
function settle() {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
  });
}

/** One consumer of a socket's arrivals, reading on a fiber of its own so what it took can be read back. */
function reading(socket: LiveSocket) {
  return Effect.gen(function* () {
    const arrivals: SocketArrival[] = [];
    yield* Effect.forkChild(
      Stream.runForEach(socket.arrivals, (arrival) =>
        Effect.sync(() => {
          arrivals.push(arrival);
        }),
      ),
    );
    yield* settle();
    return arrivals;
  });
}

function frames(arrivals: readonly SocketArrival[]): string[] {
  return arrivals.flatMap((arrival) => ("frame" in arrival ? [arrival.frame] : []));
}

function closeCodes(arrivals: readonly SocketArrival[]): (number | undefined)[] {
  return arrivals.flatMap((arrival) => ("close" in arrival ? [arrival.close.code] : []));
}

it.effect(
  "frames that arrive before anyone reads are replayed to the first consumer in order, once, and later frames pass straight through",
  () =>
    Effect.gen(function* () {
      const hold = holdSocket(new FakeTransport());
      hold.hear({ frame: "one" });
      hold.hear({ frame: "two" });
      const first = yield* reading(hold.socket);
      const second = yield* reading(hold.socket);
      hold.hear({ frame: "three" });
      yield* settle();
      assert.deepEqual(frames(first), ["one", "two", "three"]);
      assert.deepEqual(frames(second), ["three"]);
    }),
);

it.effect(
  "the close is a state: every consumer that reads after it is handed that close and nothing more",
  () =>
    Effect.gen(function* () {
      const hold = holdSocket(new FakeTransport());
      hold.hear({ frame: "only" });
      hold.hear({ close: { code: 1001 } });
      const first = yield* reading(hold.socket);
      assert.deepEqual(first, [{ frame: "only" }, { close: { code: 1001 } }]);
      const second = yield* reading(hold.socket);
      assert.deepEqual(second, [{ close: { code: 1001 } }]);
      // A socket closes once: a second close changes nothing.
      hold.hear({ close: { code: 1000 } });
      yield* settle();
      assert.deepEqual(closeCodes(first), [1001]);
    }),
);

it.effect(
  "a handshake takes the first frame without releasing the hold, and the frames behind it wait for the consumer",
  () =>
    Effect.gen(function* () {
      const hold = holdSocket(new FakeTransport());
      const waiting = yield* Effect.forkChild(hold.socket.takeFirst);
      yield* Effect.yieldNow;
      hold.hear({ frame: "answer" });
      hold.hear({ frame: "spoken-right-behind" });
      assert.deepEqual(yield* Fiber.join(waiting), { frame: "answer" });
      assert.deepEqual(frames(yield* reading(hold.socket)), ["spoken-right-behind"]);
    }),
);

it.effect("a frame already held is the handshake's answer without a wait", () =>
  Effect.gen(function* () {
    const hold = holdSocket(new FakeTransport());
    hold.hear({ frame: "answer" });
    assert.deepEqual(yield* hold.socket.takeFirst, { frame: "answer" });
  }),
);

it.effect("a close before any frame is the handshake's answer", () =>
  Effect.gen(function* () {
    const hold = holdSocket(new FakeTransport());
    hold.hear({ close: { code: 1006 } });
    assert.deepEqual(yield* hold.socket.takeFirst, { close: { code: 1006 } });
  }),
);

it.effect(
  "a hold that reaches its bound gives up its frames, closes the socket, and names the overflow in the close it delivers",
  () =>
    Effect.gen(function* () {
      const transport = new FakeTransport();
      const hold = holdSocket(transport);
      for (let index = 0; index <= HELD_SOCKET.FRAME_LIMIT; index += 1)
        hold.hear({ frame: String(index) });
      assert.equal(transport.closedByClient, true);
      const read = yield* reading(hold.socket);
      assert.deepEqual(read, [{ close: { code: HELD_SOCKET.OVERFLOW_CLOSE_CODE } }]);
      // The transport's own close follows the one the overflow chose and changes nothing.
      hold.hear({ close: { code: 1000 } });
      yield* settle();
      assert.deepEqual(closeCodes(read), [HELD_SOCKET.OVERFLOW_CLOSE_CODE]);
    }),
);

test("send and close pass through to the transport held", () => {
  const transport = new FakeTransport();
  const hold = holdSocket(transport);
  hold.socket.send("out");
  hold.socket.close();
  assert.deepEqual(transport.sent, ["out"]);
  assert.equal(transport.closedByClient, true);
});

it.effect(
  "an interrupted first-frame wait hands nothing to anyone: what arrives afterwards is held for the consumer",
  () =>
    Effect.gen(function* () {
      const hold = holdSocket(new FakeTransport());
      const taken: SocketArrival[] = [];
      const waiting = yield* Effect.forkChild(
        Effect.tap(hold.socket.takeFirst, (arrival) =>
          Effect.sync(() => {
            taken.push(arrival);
          }),
        ),
      );
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(waiting);
      assert.equal(Exit.hasInterrupts(yield* Fiber.await(waiting)), true);
      hold.hear({ frame: "late-answer" });
      hold.hear({ close: { code: 1000 } });
      assert.deepEqual(taken, []);
      assert.deepEqual(yield* reading(hold.socket), [
        { frame: "late-answer" },
        { close: { code: 1000 } },
      ]);
    }),
);

it.effect("a socket ignored drops what it holds and what follows, and stays open", () =>
  Effect.gen(function* () {
    const transport = new FakeTransport();
    const hold = holdSocket(transport);
    hold.hear({ frame: "unread" });
    hold.socket.ignore();
    for (let index = 0; index <= HELD_SOCKET.FRAME_LIMIT; index += 1)
      hold.hear({ frame: String(index) });
    assert.equal(transport.closedByClient, false);
    assert.deepEqual(yield* reading(hold.socket), []);
  }),
);
