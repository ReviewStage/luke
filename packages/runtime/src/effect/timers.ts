/**
 * Delay, in Effect's own terms. A `Clock` is already a reading of now and a
 * sleep a test can drive without waiting out a real one, and a fiber forked
 * into a `Scope` is already what a cancellable schedule is.
 */
import { Duration, Effect, type Fiber, type Schedule, type Scope } from "effect";

/**
 * Runs `work` once, `delayMs` after the fork, in a fiber the scope interrupts.
 * The scope closing is what cancels the schedule, so no caller holds a handle
 * whose only purpose is to be handed back.
 */
export const scheduleOnce = <A, E, R>(
  delayMs: number,
  work: Effect.Effect<A, E, R>,
): Effect.Effect<Fiber.RuntimeFiber<A, E>, never, R | Scope.Scope> =>
  Effect.forkScoped(Effect.delay(work, Duration.millis(delayMs)));

/**
 * Repeats `work` on a schedule, in a fiber the scope interrupts. The cadence
 * stays data — a `Schedule` composed from the delays a caller already states —
 * rather than a loop reading a flag another fiber writes.
 */
export const scheduleRepeat = <A, E, R, Out>(
  schedule: Schedule.Schedule<Out, A, R>,
  work: Effect.Effect<A, E, R>,
): Effect.Effect<Fiber.RuntimeFiber<Out, E>, never, R | Scope.Scope> =>
  Effect.forkScoped(Effect.repeat(work, schedule));
