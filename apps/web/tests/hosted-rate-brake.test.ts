import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, TestClock } from "effect";
import { test } from "vitest";
import { createRateBrake, makeRateBrake } from "../server/hosted/rate-brake.js";

/**
 * `RateBrake.check` itself, over `Clock`, so the window turning over is
 * tested against `TestClock` rather than by a route faking a `now` it no
 * longer passes through.
 */

const CONFIG = { windowMs: 60_000, maxRequestsPerWindow: 2, maxTrackedUsers: 2 } as const;

it.effect("admits up to the window's ceiling and refuses the next", () =>
  Effect.gen(function* () {
    const brake = makeRateBrake(CONFIG);
    assert.equal(yield* brake.check("user-1"), true);
    assert.equal(yield* brake.check("user-1"), true);
    assert.equal(yield* brake.check("user-1"), false);
  }),
);

it.effect("the window turning over frees the account again", () =>
  Effect.gen(function* () {
    const brake = makeRateBrake(CONFIG);
    assert.equal(yield* brake.check("user-1"), true);
    assert.equal(yield* brake.check("user-1"), true);
    assert.equal(yield* brake.check("user-1"), false);
    yield* TestClock.adjust(`${CONFIG.windowMs + 1} millis`);
    assert.equal(yield* brake.check("user-1"), true);
  }),
);

it.effect("each user spends its own budget", () =>
  Effect.gen(function* () {
    const brake = makeRateBrake(CONFIG);
    assert.equal(yield* brake.check("user-1"), true);
    assert.equal(yield* brake.check("user-1"), true);
    assert.equal(yield* brake.check("user-1"), false);
    assert.equal(yield* brake.check("user-2"), true);
  }),
);

it.effect("a single ask heavier than the whole window is always refused", () =>
  Effect.gen(function* () {
    const brake = makeRateBrake(CONFIG);
    assert.equal(yield* brake.check("user-1", CONFIG.maxRequestsPerWindow + 1), false);
  }),
);

it.effect("a batch spends its own weight rather than one slot per call", () =>
  Effect.gen(function* () {
    const brake = makeRateBrake(CONFIG);
    assert.equal(yield* brake.check("user-1", CONFIG.maxRequestsPerWindow), true);
    assert.equal(yield* brake.check("user-1", 1), false);
  }),
);

it.effect("past maxTrackedUsers every tracked user is forgotten, not grown", () =>
  Effect.gen(function* () {
    const brake = makeRateBrake(CONFIG);
    assert.equal(yield* brake.check("user-1"), true);
    assert.equal(yield* brake.check("user-1"), true);
    assert.equal(yield* brake.check("user-1"), false);
    yield* brake.check("user-2");
    // The map now holds its two tracked users; a third forgets both.
    assert.equal(yield* brake.check("user-3"), true);
    // user-1's own window was forgotten, so it is admitted again.
    assert.equal(yield* brake.check("user-1"), true);
  }),
);

test("the promise door answers the older brake's own polarity: true is over the window", async () => {
  const rateLimited = createRateBrake(CONFIG);
  assert.equal(await rateLimited("user-1"), false);
  assert.equal(await rateLimited("user-1"), false);
  assert.equal(await rateLimited("user-1"), true);
});
