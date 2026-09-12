import assert from "node:assert/strict";
import { test } from "vitest";
import { HELD_SOCKET, holdSocket } from "./held-socket.js";
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

test("the hold releases per channel: a consumer that listens for frames alone is handed the held close when it asks for closes, however late", () => {
  const inner = new FakeLiveSocket();
  const held = holdSocket(inner);
  inner.receiveText("only");
  inner.closeFromServer({ code: 1001 });
  const frames: string[] = [];
  held.onMessage((data) => frames.push(data));
  assert.deepEqual(frames, ["only"]);
  const closes: (number | undefined)[] = [];
  held.onClose((close) => closes.push(close.code));
  assert.deepEqual(closes, [1001]);
  inner.closeFromServer({ code: 1000 });
  assert.deepEqual(closes, [1001, 1000]);
});

test("a handshake takes the first frame without releasing the hold, and the frames behind it wait for the consumer", async () => {
  const inner = new FakeLiveSocket();
  const held = holdSocket(inner);
  const first = held.takeFirst();
  inner.receiveText("answer");
  inner.receiveText("spoken-right-behind");
  assert.deepEqual(await first, { frame: "answer" });
  const frames: string[] = [];
  held.onMessage((data) => frames.push(data));
  assert.deepEqual(frames, ["spoken-right-behind"]);
});

test("a close before any frame is the handshake's answer", async () => {
  const inner = new FakeLiveSocket();
  const held = holdSocket(inner);
  inner.closeFromServer({ code: 1006 });
  assert.deepEqual(await held.takeFirst(), { close: { code: 1006 } });
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
  inner.closeFromServer({ code: 1000 });
  assert.deepEqual(codes, [HELD_SOCKET.OVERFLOW_CLOSE_CODE, 1000]);
});

test("send and close pass through to the socket held", () => {
  const inner = new FakeLiveSocket();
  const held = holdSocket(inner);
  held.send("out");
  held.close();
  assert.deepEqual(inner.sent, ["out"]);
  assert.equal(inner.closedByClient, true);
});

test("a withdrawn first-frame wait hands nothing to anyone: what arrives afterwards is held for the consumer", async () => {
  const inner = new FakeLiveSocket();
  const held = holdSocket(inner);
  let resolved = false;
  void held.takeFirst().then(() => {
    resolved = true;
  });
  held.cancelFirst();
  inner.receiveText("late-answer");
  inner.closeFromServer({ code: 1000 });
  await Promise.resolve();
  assert.equal(resolved, false);
  const frames: string[] = [];
  held.onMessage((data) => frames.push(data));
  assert.deepEqual(frames, ["late-answer"]);
  const codes: (number | undefined)[] = [];
  held.onClose((close) => codes.push(close.code));
  assert.deepEqual(codes, [1000]);
});
