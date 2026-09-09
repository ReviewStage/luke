import { type IDisposable, toDisposable } from "@sidecar/wire";

/**
 * What a scheduler hands back so the same schedule can be cancelled. A
 * browser answers with a number, Node with a timer object, and a test with
 * whatever it keys its own map by — so the handle is only ever handed back,
 * never read. One type at the bottom of the graph, so a schedule made in one
 * package is cancellable in another.
 */
export type ScheduledTimer = number | object;

/**
 * What time it is and how to run something later, as one seam. A component
 * that takes a clock is drivable by a test without waiting out a real delay,
 * and cancellation rides on the handle the schedule answers with rather than
 * on a second function beside it, so no caller has to keep a token and the
 * matching canceller together.
 */
export interface Clock {
  now(): number;
  schedule(delayMs: number, run: () => void): IDisposable;
}

/** The process's own clock: what every owner of a schedule runs on unless a test hands it another. */
export const systemClock: Clock = {
  now: () => Date.now(),
  schedule: (delayMs, run) => {
    const timer = globalThis.setTimeout(run, delayMs);
    // A schedule never holds the process open by itself: every owner here is
    // already kept alive by the work it waits on, and a process with nothing
    // else left has nothing left for the callback to reach either.
    timer.unref();
    return toDisposable(() => globalThis.clearTimeout(timer));
  },
};

/** One day in milliseconds, for every age, half-life, and lookback measured in days. */
export const DAY_MS = 24 * 60 * 60 * 1000;
