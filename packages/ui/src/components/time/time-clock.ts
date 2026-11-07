import { createStore, useCreateStore, useSelector } from "@tanstack/react-store";
import { Clock, Duration, Effect, Schedule, Stream } from "effect";
import { type ReactNode, useEffect } from "react";
import { forkEffect } from "../../ui-runtime.js";
import { streamInto } from "../../wait.js";

/**
 * time-clock.ts -- the ticks the window moves on: the minute a row's age and a call's day are said from, the second a run's length counts in, and the beat a working mark steps on.
 *
 * The minute is one TanStack `Store` every reader shares, written by one
 * owner, `TimeTicks`, which the window mounts once (`@repo/panel`'s `App`)
 * and which runs it for as long as it stands; a minute with no reader
 * notifies nobody, so nothing redraws on it. The second and the beat are
 * each reader's own: every reader runs its own tick from a `useEffect`, so
 * nothing ticks five times a second while no working mark is on screen.
 * Readers side by side stay in step without sharing a tick, because each
 * reads its phase off the clock (`now / period`) and sleeps to the clock's
 * next boundary, so every one moves on the same instant.
 *
 * The ticks fork on the library's edge (`../../ui-runtime.ts`), so no row
 * arms a timer of its own and a test advances them on a `TestClock`. A test
 * whose minute must move mounts `TimeTicks`; without it the minute stands at
 * the render's time.
 */

/** How often the age of a moment moves: the finest unit it says. */
const MINUTE_TICK = Duration.minutes(1);

/** How often a run's length moves, in milliseconds: the finest unit it says. */
const SECOND_MS = 1000;

/**
 * How often a working mark's pixels step a cell, in milliseconds. Note that
 * it is a literal, as an endless loop's period may be, because a mark held
 * still never reads it.
 */
const BEAT_MS = 200;

/** The time read on the clock once a minute; none before its first reading. */
const minuteStore = createStore<number | undefined>(undefined);

/** The window's minute, read once at once and again after each wait. */
const minuteTicking: Effect.Effect<void> = streamInto(
  Stream.fromEffectSchedule(Clock.currentTimeMillis, Schedule.spaced(MINUTE_TICK)),
  minuteStore,
);

/**
 * Calls `onTick` with the time now, and again on each boundary of `periodMs`
 * the clock crosses, until interrupted. Note that it sleeps to the boundary
 * rather than a whole period, so every tick on the same period lands on the
 * same instant, and a late wake never drifts the next.
 */
function onBoundaries(periodMs: number, onTick: (now: number) => void): Effect.Effect<void> {
  return Effect.forever(
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.andThen(
        Effect.sync(() => onTick(now)),
        Effect.sleep(Duration.millis(periodMs - (now % periodMs))),
      ),
    ),
  );
}

/**
 * Runs the window's minute for as long as it stands, and draws `children`.
 * Note that the minute forgets its last reading as it goes, so a window that
 * mounts it again never draws a stale one.
 */
export function TimeTicks({ children }: { readonly children?: ReactNode }): ReactNode {
  useEffect(() => {
    const stop = forkEffect(minuteTicking);
    return () => {
      stop();
      minuteStore.setState(() => undefined);
    };
  }, []);
  return children;
}

/**
 * The time the window's ages count from, moved on once a minute. Note that
 * the time read at the render stands in until the tick's first reading
 * lands, so a row never draws a blank.
 */
export function useMinute(): number {
  return useSelector(minuteStore) ?? Date.now();
}

/**
 * The time a run's length counts from, moved on at each second the clock
 * crosses while this reader stands, with the render's time standing in
 * until the first reading lands. The reading is the reader's own store,
 * created for its lifetime (`useCreateStore`).
 */
export function useSecond(): number {
  const second = useCreateStore<number | undefined>(undefined);
  useEffect(
    () => forkEffect(onBoundaries(SECOND_MS, (now) => second.setState(() => now))),
    [second],
  );
  return useSelector(second) ?? Date.now();
}

/**
 * Calls `onBeat` with the beat working marks step on, five times a second
 * while this listener stands, at once and then on each 200ms boundary of
 * the clock, so marks side by side step in phase. Note that it renders
 * nothing, because a mark writes its pixels' `transform`s itself and a beat
 * that re-rendered every mark would run React five times a second for as
 * long as an agent works. `onBeat` must keep its identity across renders, or
 * each render listens again.
 */
export function useOnBeat(onBeat: (beat: number) => void): void {
  useEffect(
    () => forkEffect(onBoundaries(BEAT_MS, (now) => onBeat(Math.floor(now / BEAT_MS)))),
    [onBeat],
  );
}
