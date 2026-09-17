// admin-write-chain.test.ts -- the favorite write chain coalesces presses and draws only outcomes.
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { AdminWriteChain } from "../src/admin/use-admin-read";

interface Sent {
  id: string;
  value: boolean;
  settle: (landed: boolean) => void;
  answered: Promise<boolean>;
}

/** A chain over a network the test settles by hand, recording every draw. */
function chain(signal: AbortSignal = new AbortController().signal) {
  const sent: Sent[] = [];
  const drawn: Array<[string, boolean]> = [];
  const subject = new AdminWriteChain(
    (id, value) => {
      let settle: (landed: boolean) => void = () => undefined;
      const answered = new Promise<boolean>((resolve) => {
        settle = resolve;
      });
      sent.push({ id, value, settle, answered });
      return answered;
    },
    (id, value) => drawn.push([id, value]),
    signal,
  );
  return { subject, sent, drawn };
}

/**
 * Settles the nth request, which the test asserts was sent, and then follows
 * the answer the fake handed the subject. Note that the subject reads that one
 * answer on two turns of its own — the attempt returns on the turn the answer
 * lands, and the chain's loop resumes on the turn after it — so the test waits
 * on that same promise twice rather than on a clock.
 */
const settle = (sent: readonly Sent[], index: number, landed: boolean): Effect.Effect<void> =>
  Effect.promise(async () => {
    const request = sent[index];
    assert.ok(request, `request ${index} was sent`);
    request.settle(landed);
    await request.answered;
    await request.answered;
  });

it.effect("a press draws at once and sends one request", () =>
  Effect.sync(() => {
    const { subject, sent, drawn } = chain();
    subject.press("a", true);
    assert.deepEqual(drawn, [["a", true]]);
    assert.deepEqual(
      sent.map((s) => s.value),
      [true],
    );
  }),
);

it.effect(
  "presses faster than the network coalesce into the next request, newest intent only",
  () =>
    Effect.gen(function* () {
      const { subject, sent, drawn } = chain();
      subject.press("a", true);
      subject.press("a", false);
      subject.press("a", true);
      subject.press("a", false);
      assert.equal(sent.length, 1);
      yield* settle(sent, 0, true);
      assert.deepEqual(
        sent.map((s) => s.value),
        [true, false],
      );
      yield* settle(sent, 1, true);
      assert.equal(sent.length, 2);
      assert.deepEqual(drawn.at(-1), ["a", false]);
    }),
);

it.effect("a failed write puts the old value back only when no newer press has spoken", () =>
  Effect.gen(function* () {
    const { subject, sent, drawn } = chain();
    subject.press("a", true);
    yield* settle(sent, 0, false);
    assert.deepEqual(drawn, [
      ["a", true],
      ["a", false],
    ]);

    subject.press("a", true);
    subject.press("a", false);
    yield* settle(sent, 1, false);
    // The failed PUT is not undrawn: the newer DELETE's press already drew false.
    assert.deepEqual(drawn.slice(2), [
      ["a", true],
      ["a", false],
    ]);
    yield* settle(sent, 2, true);
    assert.deepEqual(drawn.at(-1), ["a", false]);
  }),
);

it.effect("subjects have chains of their own", () =>
  Effect.sync(() => {
    const { subject, sent } = chain();
    subject.press("a", true);
    subject.press("b", true);
    assert.deepEqual(
      sent.map((s) => s.id),
      ["a", "b"],
    );
  }),
);

it.effect("an aborted chain draws nothing once its request settles", () =>
  Effect.gen(function* () {
    const controller = new AbortController();
    const { subject, sent, drawn } = chain(controller.signal);
    subject.press("a", true);
    controller.abort();
    yield* settle(sent, 0, true);
    assert.deepEqual(drawn, [["a", true]]);
  }),
);
