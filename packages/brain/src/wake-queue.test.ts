import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { test } from "vitest";
import { advanceHarness, effectHarness } from "./effect/harness.js";
import { ABC, claude, DEF, edge, NOW, quietAnswer } from "./harness.js";
import { BRAIN_WAKE_KIND, type BrainWakeEvent } from "./wake-events.js";
import { WakeQueue } from "./wake-queue.js";

const wake = (providerSessionId: string, atMs = 0): BrainWakeEvent => ({
  kind: BRAIN_WAKE_KIND.HOOK,
  identity: { providerId: "claude-code", providerSessionId },
  atMs,
});

/** A queue whose window never arms itself, so what it holds is the whole of what a test reads. */
const held = (capacity: number) =>
  new WakeQueue({
    coalesceMs: 1_000,
    capacity,
    now: () => NOW,
    schedule: () => 0,
    cancel: () => undefined,
    quietUntil: () => undefined,
    flush: () => undefined,
  });

test("what the queue holds is what was pushed, in order, and a take empties it", () => {
  const queue = held(20);
  queue.push([wake("a"), wake("b")]);
  assert.equal(queue.size(), 2);
  assert.deepEqual(queue.take(), [wake("a"), wake("b")]);
  assert.equal(queue.size(), 0);
});

test("the same observation is one entry, pushed twice or twice in one batch", () => {
  const queue = held(20);
  queue.push([wake("a", 1)]);
  queue.push([wake("a", 1), wake("b", 1)]);
  assert.deepEqual(queue.take(), [wake("a", 1), wake("b", 1)]);

  const batched = held(20);
  batched.push([wake("a", 1), wake("a", 1)]);
  assert.deepEqual(batched.take(), [wake("a", 1)]);
});

test("past capacity the oldest goes, over two pushes or one", () => {
  const queue = held(2);
  queue.push([wake("a"), wake("b")]);
  queue.push([wake("c")]);
  assert.deepEqual(queue.take(), [wake("b"), wake("c")]);

  const single = held(2);
  single.push([wake("a"), wake("b"), wake("c")]);
  assert.deepEqual(single.take(), [wake("b"), wake("c")]);
});

test("a requeue prepends, ahead of what a push holds and with no capacity trim", () => {
  const queue = held(1);
  queue.requeue([wake("a"), wake("b")], 0);
  assert.equal(queue.size(), 2);
  assert.deepEqual(queue.take(), [wake("a"), wake("b")]);

  const pushed = held(20);
  pushed.push([wake("b")]);
  pushed.requeue([wake("a")], 0);
  assert.deepEqual(pushed.take(), [wake("a"), wake("b")]);
});

test("clear drops every pending wake", () => {
  const queue = held(20);
  queue.push([wake("a"), wake("b")]);
  queue.clear();
  assert.equal(queue.size(), 0);
  assert.deepEqual(queue.take(), []);
});

/**
 * The coalescing window against a quiet model: wakes postponed by a throttle
 * open once the quiet ends rather than being dropped. Written over the
 * `TestClock` harness (`./effect/harness.js`), the pattern P5-17 moves the
 * rest of this package's clock-driven tests onto.
 */

describe("wake queue", () => {
  it.effect("a quiet client keeps the wakes pending and retries once the quiet ends", () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      h.client.answers.push(quietAnswer(NOW + 60_000));
      yield* Effect.promise(() => h.agent.wake([edge(ABC), edge(DEF)]));
      yield* advanceHarness(NOW + 3_000);
      assert.equal(h.client.inputs.length, 1);
      assert.equal(h.agent.pendingWakes(), 2);
      // The throttled turn consumed nothing: both captured entries stand on disk
      // with their capture cursors, and no consumed cursor moved.
      assert.equal(h.persisted.length, 1);
      assert.equal(h.repository.state?.inbox.length, 2);
      assert.deepEqual(h.repository.state?.captureCursors, {
        [claude.id]: { abc: "abc-cursor", def: "def-cursor" },
      });
      assert.deepEqual(h.repository.state?.cursors, {});

      h.client.quiet = NOW + 60_000;
      yield* advanceHarness(NOW + 30_000);
      assert.equal(h.client.inputs.length, 1);
      h.client.quiet = undefined;
      yield* advanceHarness(NOW + 70_000);
      assert.equal(h.client.inputs.length, 2);
      assert.equal(h.agent.pendingWakes(), 0);
      assert.equal(h.persisted.length, 2);
      // The retry read no transcript twice: the entries were consumed as captured.
      assert.equal(h.sinceReads.length, 2);
      assert.equal(h.repository.state?.inbox.length, 0);
      assert.deepEqual(h.repository.state?.cursors, h.repository.state?.captureCursors);
    }),
  );
});
