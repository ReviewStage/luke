import { forkEffect, streamInto } from "@repo/ui";
import { useCreateStore, useSelector } from "@tanstack/react-store";
import { Clock, Duration, Schedule, Stream } from "effect";
import { useEffect } from "react";

/**
 * pending-clock.ts -- the renderer clock a value given here reads while it waits on a view to carry it (`@repo/ui/pending-values`).
 *
 * A pending value counts its time from the clock's first reading after it
 * was asked, so one past `PENDING_LIMIT` lets go. The clock is read only
 * while something waits, so a window with nothing pending draws nothing on
 * its ticks; a test moves it on a `TestClock`.
 */

/** How often the runtime clock is read while a value given here waits on a view, so one past its time limit lets go. */
const PENDING_TICK = Duration.seconds(5);

/** The time now, and again each `PENDING_TICK` after, on the renderer's clock. */
const pendingClock = Stream.fromEffectSchedule(
  Clock.currentTimeMillis,
  Schedule.spaced(PENDING_TICK),
);

/**
 * The renderer clock's latest reading while `waiting`, read each
 * `PENDING_TICK`; none while nothing waits, or before its first reading.
 * The reading is the reader's own store, read only while it waits, and
 * forgotten as the wait ends, so the next wait counts afresh.
 */
export function usePendingNow(waiting: boolean): number | undefined {
  const now = useCreateStore<number | undefined>(undefined);
  useEffect(() => {
    if (!waiting) return undefined;
    const stop = forkEffect(streamInto(pendingClock, now));
    return () => {
      stop();
      now.setState(() => undefined);
    };
  }, [waiting, now]);
  const reading = useSelector(now);
  return waiting ? reading : undefined;
}
