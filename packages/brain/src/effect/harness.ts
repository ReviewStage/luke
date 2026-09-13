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

import { Chunk, Effect, TestClock } from "effect";
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
 * timestamps relative to it needs no conversion. The runtime is handed over
 * beside it, so every turn of the harness's conversation is a fiber of the
 * test's own.
 */
export const effectHarness = (
  overrides: HarnessOverrides = {},
  repository: FakeBrainStateRepository = fakeBrainStateRepository(),
): Effect.Effect<Harness> =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const clock = yield* Effect.clock;
    const runtime = yield* Effect.runtime<never>();
    return yield* plainHarness(
      { execution: runtime, now: () => clock.unsafeCurrentTimeMillis(), ...overrides },
      repository,
    );
  });

/**
 * Advances the ambient `TestClock` to `untilMs`, one due timer at a time
 * rather than jumping straight there, settling the harness's own microtask
 * chains between each — the same shape `FakeClock#advance` took. Jumping
 * straight to `untilMs` in one `TestClock.setTime` call would already read
 * `now` as `untilMs` by the time a callback's own promise chain settles far
 * enough to reschedule, so a short requeue computed from that already-jumped
 * `now` would read as due only after the target and never fire within this
 * advance; holding `now` at each due instant in turn, as the old
 * `FakeClock#advance` did, is what keeps a requeue's own delay landing
 * inside the same budget it would have under the old clock.
 */
export const advanceHarness = (untilMs: number): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (;;) {
      const due = Chunk.toReadonlyArray(yield* TestClock.sleeps())
        .filter((instant) => instant <= untilMs)
        .sort((a, b) => a - b)[0];
      if (due === undefined) break;
      yield* TestClock.setTime(due);
      yield* Effect.promise(() => settle());
    }
    yield* TestClock.setTime(untilMs);
  });

/**
 * `../harness.ts`'s `reviewing` over `effectHarness` instead of `harness`: a
 * conversation held busy by an observation turn, over the ambient `TestClock`.
 */
export const effectReviewing = (
  ...replies: readonly BrainClientAnswer[]
): Effect.Effect<{
  h: Harness;
  inner: FakeClient;
  release: () => Effect.Effect<void>;
}> =>
  Effect.gen(function* () {
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
