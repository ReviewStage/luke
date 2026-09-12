/**
 * The `now`/`schedule`/`cancel` seam an OpenClaw port still takes as a
 * constructor argument, answered from an Effect runtime's own `Clock` so a
 * caller armed on this bridge reads and schedules against whichever clock
 * that runtime carries — the real one in production, a `TestClock` in a
 * test — without the port itself importing `effect`. Starting the fiber
 * here is a run outside an Effect, which the "runtime only at an edge" rule
 * allows precisely because this bridge is that edge: it starts the work on
 * the runtime it was handed rather than building a second one.
 *
 * `cancel` has no way to be awaited, so it interrupts the fiber without
 * waiting for the interruption to finish: what it must guarantee is that the
 * callback does not run afterwards, never that the fiber has already ended.
 */

import type { Fiber } from "effect";
import { Clock, Duration, Effect, FiberId, Runtime } from "effect";
import type { ScheduledTimer } from "../scheduled-timer.js";

export interface TimerSeam {
  readonly now: () => number;
  readonly schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  readonly cancel: (timer: ScheduledTimer) => void;
}

export const timerSeamFromRuntime = (runtime: Runtime.Runtime<never>): TimerSeam => {
  const sync = Runtime.runSync(runtime);
  const fork = Runtime.runFork(runtime);
  const armed = new Map<ScheduledTimer, Fiber.RuntimeFiber<void>>();
  return {
    now: () => sync(Clock.currentTimeMillis),
    schedule: (callback, delayMs) => {
      const handle: ScheduledTimer = {};
      const fiber = fork(
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
