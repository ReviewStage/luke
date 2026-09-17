// admin-write-chain.test.ts -- the favorite write chain coalesces presses and draws only outcomes.
import assert from "node:assert/strict";
import { test } from "vitest";
import { AdminWriteChain } from "../src/admin/use-admin-read";

interface Sent {
  id: string;
  value: boolean;
  settle: (landed: boolean) => void;
}

/** A chain over a network the test settles by hand, recording every draw. */
function chain(signal: AbortSignal = new AbortController().signal) {
  const sent: Sent[] = [];
  const drawn: Array<[string, boolean]> = [];
  const subject = new AdminWriteChain(
    (id, value) => new Promise<boolean>((settle) => sent.push({ id, value, settle })),
    (id, value) => drawn.push([id, value]),
    signal,
  );
  return { subject, sent, drawn };
}

/** Settles the nth request, which the test asserts was sent. */
function settle(sent: readonly Sent[], index: number, landed: boolean): void {
  const request = sent[index];
  assert.ok(request, `request ${index} was sent`);
  request.settle(landed);
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("a press draws at once and sends one request", async () => {
  const { subject, sent, drawn } = chain();
  subject.press("a", true);
  await tick();
  assert.deepEqual(drawn, [["a", true]]);
  assert.deepEqual(
    sent.map((s) => s.value),
    [true],
  );
});

test("presses faster than the network coalesce into the next request, newest intent only", async () => {
  const { subject, sent, drawn } = chain();
  subject.press("a", true);
  await tick();
  subject.press("a", false);
  subject.press("a", true);
  subject.press("a", false);
  assert.equal(sent.length, 1);
  settle(sent, 0, true);
  await tick();
  assert.deepEqual(
    sent.map((s) => s.value),
    [true, false],
  );
  settle(sent, 1, true);
  await tick();
  assert.equal(sent.length, 2);
  assert.deepEqual(drawn.at(-1), ["a", false]);
});

test("a failed write puts the old value back only when no newer press has spoken", async () => {
  const { subject, sent, drawn } = chain();
  subject.press("a", true);
  await tick();
  settle(sent, 0, false);
  await tick();
  assert.deepEqual(drawn, [
    ["a", true],
    ["a", false],
  ]);

  subject.press("a", true);
  await tick();
  subject.press("a", false);
  settle(sent, 1, false);
  await tick();
  // The failed PUT is not undrawn: the newer DELETE's press already drew false.
  assert.deepEqual(drawn.slice(2), [
    ["a", true],
    ["a", false],
  ]);
  settle(sent, 2, true);
  await tick();
  assert.deepEqual(drawn.at(-1), ["a", false]);
});

test("subjects have chains of their own", async () => {
  const { subject, sent } = chain();
  subject.press("a", true);
  subject.press("b", true);
  await tick();
  assert.deepEqual(
    sent.map((s) => s.id),
    ["a", "b"],
  );
});

test("an aborted chain draws nothing once its request settles", async () => {
  const controller = new AbortController();
  const { subject, sent, drawn } = chain(controller.signal);
  subject.press("a", true);
  await tick();
  controller.abort();
  settle(sent, 0, true);
  await tick();
  assert.deepEqual(drawn, [["a", true]]);
});
