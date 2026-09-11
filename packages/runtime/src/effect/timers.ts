/**
 * Delay, in Effect's own terms, and the bridge back to the injected clock seam
 * while both stand. A `Clock` is already what the seam was written for — a
 * reading of now and a sleep a test can drive without waiting out a real one —
 * and a fiber forked into a `Scope` is already what a cancellable schedule is,
 * so what is left is carrying a schedule across the line to a caller that still
 * holds `schedule`/`cancel` closures.
 *
 * `timersFromRuntime` is a strangler shim: P12-03 deletes it together with the
 * `ScheduledTimer` seam, the `FakeClock` that stands in for it, and
 * `drainMicrotasks`.
 */
import {
  Clock,
  Duration,
  Effect,
  type Fiber,
  FiberId,
  ManagedRuntime,
  Runtime,
  type Schedule,
  type Scope,
} from "effect";
import type { ScheduledTimer } from "../timers.js";

/**
 * The three closures a caller of the old seam is injected with, as one name.
 * Every one of them is a caller that has not migrated yet.
 *
 * @deprecated The seam is being replaced by the `Clock` service and a fiber in
 * a `Scope`; P12-03 deletes this with `ScheduledTimer`.
 */
export interface TimerSeam {
  readonly now: () => number;
  readonly schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  readonly cancel: (timer: ScheduledTimer) => void;
}

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

/** A runtime an effect can be started on: the managed one an edge holds, or a plain one. */
export type TimerRuntime = ManagedRuntime.ManagedRuntime<never, never> | Runtime.Runtime<never>;

interface RuntimeEdge {
  readonly fork: <A, E>(effect: Effect.Effect<A, E>) => Fiber.RuntimeFiber<A, E>;
  readonly sync: <A>(effect: Effect.Effect<A>) => A;
}

const edgeOf = (runtime: TimerRuntime): RuntimeEdge =>
  ManagedRuntime.TypeId in runtime
    ? { fork: (effect) => runtime.runFork(effect), sync: (effect) => runtime.runSync(effect) }
    : { fork: Runtime.runFork(runtime), sync: Runtime.runSync(runtime) };

/**
 * The old seam, answered from a runtime's own `Clock`, so a caller still
 * injected with `now`, `schedule`, and `cancel` reads the clock the rest of the
 * process reads — a `TestClock` in a test, the real one at an edge — without
 * changing a line. Starting the fiber here is a run outside an Effect, which
 * the "runtime only at an edge" rule allows precisely because this bridge is
 * that edge for as long as it exists: it starts the work on the runtime it was
 * handed rather than building a second one, and P12-03 deletes it with the last
 * caller.
 *
 * `cancel` has no way to be awaited, so it interrupts the fiber without
 * waiting for the interruption to finish: what it must guarantee is that the
 * callback does not run afterwards, never that the fiber has already ended.
 */
export const timersFromRuntime = (runtime: TimerRuntime): TimerSeam => {
  const edge = edgeOf(runtime);
  const armed = new Map<ScheduledTimer, Fiber.RuntimeFiber<void>>();
  return {
    now: () => edge.sync(Clock.currentTimeMillis),
    schedule: (callback, delayMs) => {
      const handle: ScheduledTimer = {};
      const fiber = edge.fork(
        Effect.delay(Effect.sync(callback), Duration.millis(delayMs)).pipe(
          Effect.ensuring(Effect.sync(() => armed.delete(handle))),
        ),
      );
      armed.set(handle, fiber);
      return handle;
    },
    cancel: (timer) => {
      const fiber = armed.get(timer);
      if (fiber === undefined) return;
      armed.delete(timer);
      fiber.unsafeInterruptAsFork(FiberId.none);
    },
  };
};
