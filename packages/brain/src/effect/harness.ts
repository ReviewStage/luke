/**
 * `../harness.ts`'s `harness()` over the ambient runtime's own `Clock`
 * instead of a hand-advanced `FakeClock`, so a test written with
 * `@effect/vitest`'s `it.effect` drives the agent's timers with the
 * `TestClock` the way every other Effect test in this package already does.
 * `../harness.ts` keeps standing for the tests P5-17 has not yet moved onto
 * this one.
 *
 * `timersFromRuntime` reads and schedules against whichever runtime it is
 * handed, so capturing the currently running fiber's own runtime — the one
 * `it.effect` already provided a `TestClock` into — is what lets
 * `TestClock.setTime` reach the timers this harness's `BrainAgent` schedules,
 * with no clock of the harness's own to keep in step.
 */
import { timersFromRuntime } from "@sidecar/runtime/effect";
import { Chunk, Effect, TestClock } from "effect";
import {
  type Harness,
  type HarnessOverrides,
  NOW,
  harness as plainHarness,
  settle,
} from "../harness.js";
import { type FakeBrainStateRepository, fakeBrainStateRepository } from "../testing.js";

/**
 * Builds the harness over the current fiber's own runtime, so its `BrainAgent`
 * reads and schedules against whichever `Clock` that runtime carries — the
 * `TestClock` an `it.effect` test already stands on — set to the same `NOW`
 * every fixture in this package's tests is written against, so a repository
 * seeded with timestamps relative to it needs no conversion.
 */
export const effectHarness = (
  overrides: HarnessOverrides = {},
  repository: FakeBrainStateRepository = fakeBrainStateRepository(),
): Effect.Effect<Harness> =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const runtime = yield* Effect.runtime<never>();
    const { now, schedule, cancel } = timersFromRuntime(runtime);
    return plainHarness({ now, schedule, cancel, ...overrides }, repository);
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
