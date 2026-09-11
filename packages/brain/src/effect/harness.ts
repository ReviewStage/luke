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
import { Effect, TestClock } from "effect";
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
 * Sets the ambient `TestClock` to `untilMs`, firing every timer due by it, and
 * drains the harness's own microtask chains after — the same absolute-instant
 * shape `FakeClock#advance` took, so a converted test reads the same way.
 */
export const advanceHarness = (untilMs: number): Effect.Effect<void> =>
  Effect.andThen(
    TestClock.setTime(untilMs),
    Effect.promise(() => settle()),
  );
