import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { BrainWakeEvent } from "../wake-events.js";
import { BRAIN_WAKE_KIND } from "../wake-events.js";
import { makeWakeEventQueue } from "./wake-queue.js";

const wake = (providerSessionId: string, atMs = 0): BrainWakeEvent => ({
  kind: BRAIN_WAKE_KIND.HOOK,
  identity: { providerId: "claude-code", providerSessionId },
  atMs,
});

describe("makeWakeEventQueue", () => {
  it.effect("holds what is pushed and answers its size", () =>
    Effect.gen(function* () {
      const queue = yield* makeWakeEventQueue(20);
      yield* queue.push([wake("a"), wake("b")]);
      assert.equal(yield* queue.size, 2);
      assert.deepEqual(yield* queue.take, [wake("a"), wake("b")]);
      assert.equal(yield* queue.size, 0);
    }),
  );

  it.effect("the same observation pushed twice is one entry", () =>
    Effect.gen(function* () {
      const queue = yield* makeWakeEventQueue(20);
      yield* queue.push([wake("a", 1)]);
      yield* queue.push([wake("a", 1), wake("b", 1)]);
      assert.deepEqual(yield* queue.take, [wake("a", 1), wake("b", 1)]);
    }),
  );

  it.effect("a batch with its own duplicate is also one entry", () =>
    Effect.gen(function* () {
      const queue = yield* makeWakeEventQueue(20);
      yield* queue.push([wake("a", 1), wake("a", 1)]);
      assert.deepEqual(yield* queue.take, [wake("a", 1)]);
    }),
  );

  it.effect("past capacity the oldest goes", () =>
    Effect.gen(function* () {
      const queue = yield* makeWakeEventQueue(2);
      yield* queue.push([wake("a"), wake("b")]);
      yield* queue.push([wake("c")]);
      assert.deepEqual(yield* queue.take, [wake("b"), wake("c")]);
    }),
  );

  it.effect("a single push over capacity keeps only the newest", () =>
    Effect.gen(function* () {
      const queue = yield* makeWakeEventQueue(2);
      yield* queue.push([wake("a"), wake("b"), wake("c")]);
      assert.deepEqual(yield* queue.take, [wake("b"), wake("c")]);
    }),
  );

  it.effect("requeue puts events back at the front with no capacity trim", () =>
    Effect.gen(function* () {
      const queue = yield* makeWakeEventQueue(1);
      yield* queue.requeueFront([wake("a"), wake("b")]);
      assert.equal(yield* queue.size, 2);
      assert.deepEqual(yield* queue.take, [wake("a"), wake("b")]);
    }),
  );

  it.effect("requeue prepends ahead of what a push already holds", () =>
    Effect.gen(function* () {
      const queue = yield* makeWakeEventQueue(20);
      yield* queue.push([wake("b")]);
      yield* queue.requeueFront([wake("a")]);
      assert.deepEqual(yield* queue.take, [wake("a"), wake("b")]);
    }),
  );

  it.effect("clear empties the queue", () =>
    Effect.gen(function* () {
      const queue = yield* makeWakeEventQueue(20);
      yield* queue.push([wake("a"), wake("b")]);
      yield* queue.clear;
      assert.equal(yield* queue.size, 0);
      assert.deepEqual(yield* queue.take, []);
    }),
  );
});
