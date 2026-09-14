/**
 * `../harness.ts`'s `harness()` over the ambient runtime's own `Clock`
 * instead of a hand-advanced clock, so a test written with `@effect/vitest`'s
 * `it.effect` drives the agent's timers with the `TestClock` the way every
 * other Effect test in this package already does. Every test in this package
 * that drives time or the seam is on this harness now; `../harness.ts`'s own
 * `harness()` still stands as the object this one builds on top of, and
 * `agentOn`/`heldOpenRuntime` stay there for the one test that builds a
 * second `BrainAgent` or runtime by hand without needing either to advance.
 *
 * Nothing here bridges a clock seam: `BrainAgent.make` takes the `Clock` and
 * the scope of the fiber that builds it, so an agent built inside an
 * `it.effect` stamps and sleeps on that test's own `TestClock` without being
 * handed a `now`/`schedule`/`cancel` triple. What `../harness.ts` still takes
 * a `now` for is the `BrainStateStore` beside the agent, which reads a
 * closure rather than a clock.
 */

import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import {
  answered,
  type BrainClientAnswer,
  FakeClient,
  gatedClient,
  type Harness,
  type HarnessOverrides,
  message,
  NOW,
  harness as plainHarness,
  settle,
} from "../harness.js";
import { type FakeBrainStateRepository, fakeBrainStateRepository } from "../testing.js";

/**
 * Builds the harness on the current fiber, so its `BrainAgent` stamps and
 * sleeps on whichever `Clock` that fiber carries — the `TestClock` an
 * `it.effect` test already stands on — set to the same `NOW` every fixture in
 * this package's tests is written against, so a repository seeded with
 * timestamps relative to it needs no conversion. The test's own services are
 * handed over beside it, so every turn of the harness's conversation is a
 * fiber of the test's own.
 */
export const effectHarness = /* @__PURE__ */ Effect.fn("effectHarness")(function* (
  overrides: HarnessOverrides = {},
  repository: FakeBrainStateRepository = fakeBrainStateRepository(),
): Effect.fn.Return<Harness> {
  yield* TestClock.setTime(NOW);
  const clock = yield* Clock.Clock;
  const context = yield* Effect.context<never>();
  return yield* plainHarness(
    {
      execution: context,
      now: () => clock.currentTimeMillisUnsafe(),
      ...overrides,
    },
    repository,
  );
});

/**
 * Advances the ambient `TestClock` to `untilMs` and settles the harness's own
 * microtask chains after it. The stepping itself is the clock's: `setTime`
 * holds `now` at each due instant in turn, opens that sleeper, and yields
 * before it reads its pending sleeps again, so a callback whose own promise
 * chain reschedules a short wait from the instant it was woken at has its
 * requeue registered in time to be fired by the same advance rather than
 * being computed from a `now` already jumped to the target. What the yield
 * does not do is drain the promise chains a turn leaves behind it, which is
 * what the settle here is for.
 */
export const advanceHarness = /* @__PURE__ */ Effect.fn("advanceHarness")(function* (
  untilMs: number,
): Effect.fn.Return<void> {
  yield* TestClock.setTime(untilMs);
  yield* Effect.promise(() => settle());
});

/**
 * `../harness.ts`'s `reviewing` over `effectHarness` instead of `harness`: a
 * conversation held busy by an observation turn, over the ambient `TestClock`.
 */
export const effectReviewing = /* @__PURE__ */ Effect.fn("effectReviewing")(function* (
  ...replies: readonly BrainClientAnswer[]
): Effect.fn.Return<{
  h: Harness;
  inner: FakeClient;
  release: () => Effect.Effect<void>;
}> {
  const inner = new FakeClient();
  const gated = gatedClient(inner);
  const h = yield* effectHarness({ client: gated.client });
  inner.answers.push(answered([message("nothing spoken")]), ...replies);
  yield* h.agent.releaseHeld([{ briefing: "held", decidedAt: NOW }]);
  yield* Effect.promise(() => settle());
  return {
    h,
    inner,
    release: () =>
      Effect.gen(function* () {
        gated.open();
        yield* Effect.promise(() => settle());
        while (h.agent.busy()) yield* Effect.promise(() => settle());
      }),
  };
});
