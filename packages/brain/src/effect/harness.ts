/**
 * `../harness.ts`'s `harness()` over the ambient runtime's own `Clock`
 * instead of a hand-advanced `FakeClock`, so a test written with
 * `@effect/vitest`'s `it.effect` drives the agent's timers with the
 * `TestClock` the way every other Effect test in this package already does.
 * Every test in this package that drives time or the seam is on this harness
 * now; `../harness.ts`'s own `harness()` and `FakeClock` still stand only as
 * the object this one builds on top of and overrides the clock seam of, and
 * `agentOn`/`heldOpenRuntime` stay there for the one test that builds a
 * second `BrainAgent` or runtime by hand without needing either to advance.
 *
 * `timersFromRuntime` reads and schedules against whichever runtime it is
 * handed, so capturing the currently running fiber's own runtime — the one
 * `it.effect` already provided a `TestClock` into — is what lets
 * `TestClock.setTime` reach the timers this harness's `BrainAgent` schedules,
 * with no clock of the harness's own to keep in step. The same runtime is
 * what every run of the harness's agent is a fiber on, so a run and the
 * timers around it stand on one clock rather than two.
 */
import { type TimerSeam, timersFromRuntime } from "@sidecar/runtime/effect";
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
 * The `now`/`schedule`/`cancel` seam of the current fiber's own runtime, for
 * a caller building a second clock-driven collaborator (another `BrainAgent`,
 * a `BrainGenerationClock`) that must read the same ambient `TestClock` an
 * `effectHarness`'s own agent does, rather than a clock of its own that never
 * advances alongside it.
 */
export const ambientTimers: Effect.Effect<TimerSeam> = Effect.gen(function* () {
  const runtime = yield* Effect.runtime<never>();
  return timersFromRuntime(runtime);
});

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
    return plainHarness({ execution: runtime, now, schedule, cancel, ...overrides }, repository);
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
    h.agent.releaseHeld([{ briefing: "held", decidedAt: NOW }]);
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
