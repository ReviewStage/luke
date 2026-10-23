import { useAtomValue } from "@effect/atom-react";
import { Clock, Duration, Layer, Schedule, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

/**
 * time-clock.ts -- the two ticks every time moves on: the minute a row's age and a call's day are said from, and the second a run's length counts in.
 *
 * Each is one atom every `Time` reads, run only while some time stands on
 * screen, so a tab that closed or a list scrolled away leaves nothing
 * ticking. The waits are the atoms' own work on the registry the app's root
 * provides, over no services, so no row arms a timer of its own and a test
 * advances the tick on a `TestClock`.
 */

/** How often the age of a moment moves: the finest unit it says. */
const MINUTE_TICK = Duration.minutes(1);

/** How often a run's length moves: the finest unit it says. */
const SECOND_TICK = Duration.seconds(1);

/** The time now, and again after each wait, on whatever clock the stream runs under. */
function ticksEvery(wait: Duration.Duration): Stream.Stream<number> {
  return Stream.fromEffectSchedule(Clock.currentTimeMillis, Schedule.spaced(wait));
}

/**
 * The runtime the two ticks run on: no services stand, so they run on the
 * real clock, and a test seeds this atom in its registry with a `TestClock`
 * to move them. It is kept alive because a runtime the registry disposed
 * between two readings would be a second runtime to whatever it handed out.
 */
export const timeRuntime = Atom.keepAlive(Atom.runtime(Layer.empty));

const minuteAtom = timeRuntime.atom(ticksEvery(MINUTE_TICK));
const secondAtom = timeRuntime.atom(ticksEvery(SECOND_TICK));

/**
 * The time the window's ages count from, moved on once a minute while any of
 * them reads it. Note that the time read at the render stands in until the
 * tick's first reading lands, so a row never draws a blank.
 */
export function useMinute(): number {
  return AsyncResult.getOrElse(useAtomValue(minuteAtom), () => Date.now());
}

/** The time a run's length counts from, moved on once a second while any count reads it, with the render's time standing in until the first reading lands. */
export function useSecond(): number {
  return AsyncResult.getOrElse(useAtomValue(secondAtom), () => Date.now());
}
