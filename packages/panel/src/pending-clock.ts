import { useAtomValue } from "@effect/atom-react";
import { Clock, Duration, Option, Schedule, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { rendererRuntime } from "./renderer-runtime.js";

/**
 * pending-clock.ts -- the renderer clock a value given here reads while it waits on a view to carry it (`@luke/ui/pending-values`).
 *
 * A pending value counts its time from the clock's first reading after it
 * was asked, so one past `PENDING_LIMIT` lets go. The clock is read only
 * while something waits, so a window with nothing pending draws nothing on
 * its ticks; a test moves it on a `TestClock`.
 */

/** How often the runtime clock is read while a value given here waits on a view, so one past its time limit lets go. */
const PENDING_TICK = Duration.seconds(5);

/** The time now, and again each `PENDING_TICK` after, on the renderer's clock. */
const pendingClockAtom = rendererRuntime.atom(
  Stream.fromEffectSchedule(Clock.currentTimeMillis, Schedule.spaced(PENDING_TICK)),
);

/** No reading, while nothing waits on a view. */
const NO_PENDING_CLOCK = Atom.make(AsyncResult.initial<number>());

/** The renderer clock's latest reading while `waiting`, read each `PENDING_TICK`; none while nothing waits, or before its first reading. */
export function usePendingNow(waiting: boolean): number | undefined {
  return Option.getOrUndefined(
    AsyncResult.value(useAtomValue(waiting ? pendingClockAtom : NO_PENDING_CLOCK)),
  );
}
