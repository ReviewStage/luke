import assert from "node:assert/strict";
import { test } from "vitest";
import { HELD_SOCKET, type HeldArrival, holdSocket } from "./held-socket.js";
import { FakeLiveSocket } from "./testing.js";

test("frames that arrive before anyone listens are replayed to the first listener in order, once, and later frames pass straight through", () => {
  const inner = new FakeLiveSocket();
  const held = holdSocket(inner);
  inner.receiveText("one");
  inner.receiveText("two");
  const first: string[] = [];
  const second: string[] = [];
  held.onMessage((data) => first.push(data));
  held.onMessage((data) => second.push(data));
  inner.receiveText("three");
  assert.deepEqual(first, ["one", "two", "three"]);
  assert.deepEqual(second, ["three"]);
});

test("the hold releases per channel: a consumer that listens for frames alone is handed the close when it asks for closes, however late, and so is every listener after it", () => {
  const inner = new FakeLiveSocket();
  const held = holdSocket(inner);
  inner.receiveText("only");
  inner.closeFromServer({ code: 1001 });
  const frames: string[] = [];
  held.onMessage((data) => frames.push(data));
  assert.deepEqual(frames, ["only"]);
  const first: (number | undefined)[] = [];
  const second: (number | undefined)[] = [];
  held.onClose((close) => first.push(close.code));
  held.onClose((close) => second.push(close.code));
  assert.deepEqual(first, [1001]);
  assert.deepEqual(second, [1001]);
  // A socket closes once: a second close event changes nothing.
  inner.closeFromServer({ code: 1000 });
  assert.deepEqual(first, [1001]);
});

test("a handshake takes the first frame without releasing the hold, and the frames behind it wait for the consumer", () => {
  const inner = new FakeLiveSocket();
  const held = holdSocket(inner);
  const arrivals: HeldArrival[] = [];
  held.takeFirst((arrival) => arrivals.push(arrival));
  inner.receiveText("answer");
  inner.receiveText("spoken-right-behind");
  assert.deepEqual(arrivals, [{ frame: "answer" }]);
  const frames: string[] = [];
  held.onMessage((data) => frames.push(data));
  assert.deepEqual(frames, ["spoken-right-behind"]);
});

test("a close before any frame is the handshake's answer", () => {
  const inner = new FakeLiveSocket();
  const held = holdSocket(inner);
  inner.closeFromServer({ code: 1006 });
  const arrivals: HeldArrival[] = [];
  held.takeFirst((arrival) => arrivals.push(arrival));
  assert.deepEqual(arrivals, [{ close: { code: 1006 } }]);
});

test("a hold that reaches its bound gives up its frames, closes the socket, and names the overflow in the close it delivers", () => {
  const inner = new FakeLiveSocket();
  const held = holdSocket(inner);
  for (let index = 0; index <= HELD_SOCKET.FRAME_LIMIT; index += 1)
    inner.receiveText(String(index));
  assert.equal(inner.closedByClient, true);
  const frames: string[] = [];
  held.onMessage((data) => frames.push(data));
  assert.deepEqual(frames, []);
  const codes: (number | undefined)[] = [];
  held.onClose((close) => codes.push(close.code));
  assert.deepEqual(codes, [HELD_SOCKET.OVERFLOW_CLOSE_CODE]);
  // The transport's own close follows the one the overflow chose and changes nothing.
  inner.closeFromServer({ code: 1000 });
  assert.deepEqual(codes, [HELD_SOCKET.OVERFLOW_CLOSE_CODE]);
});

test("send and close pass through to the socket held", () => {
  const inner = new FakeLiveSocket();
  const held = holdSocket(inner);
  held.send("out");
  held.close();
  assert.deepEqual(inner.sent, ["out"]);
  assert.equal(inner.closedByClient, true);
});

test("a withdrawn first-frame wait hands nothing to anyone: what arrives afterwards is held for the consumer", () => {
  const inner = new FakeLiveSocket();
  const held = holdSocket(inner);
  const arrivals: HeldArrival[] = [];
  const withdraw = held.takeFirst((arrival) => arrivals.push(arrival));
  withdraw();
  inner.receiveText("late-answer");
  inner.closeFromServer({ code: 1000 });
  assert.deepEqual(arrivals, []);
  const frames: string[] = [];
  held.onMessage((data) => frames.push(data));
  assert.deepEqual(frames, ["late-answer"]);
  const codes: (number | undefined)[] = [];
  held.onClose((close) => codes.push(close.code));
  assert.deepEqual(codes, [1000]);
});
