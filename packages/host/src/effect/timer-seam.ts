/**
 * The `now`/`schedule`/`cancel` seam a caller still injected with those
 * closures reads, answered from an Effect runtime's own `Clock` — the real
 * one the host's `ManagedRuntime` carries in production, or the `TestClock`
 * a test provides — so composing a session over this seam still runs on the
 * one clock the rest of a turn does. Starting the fiber here is a run
 * outside an Effect, which the "runtime only at an edge" rule allows
 * precisely because this bridge is that edge: it starts the work on the
 * runtime it was handed rather than building a second one.
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
