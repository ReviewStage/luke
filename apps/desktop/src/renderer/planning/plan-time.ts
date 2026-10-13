import { useAtomValue } from "@effect/atom-react";
import { Clock, Duration, Schedule, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { rendererRuntime } from "../renderer-runtime";

/**
 * plan-time.ts -- how long ago a plan was last updated, as the sidebar's row says it, and the minute that says it again.
 *
 * The row's word is the shortest a devtool's list uses: "now", then minutes,
 * hours, days, and weeks by their letter, and the date itself once a plan is
 * a month old, so a glance down the column reads like Codex's and Cursor's.
 * The words move on a minute's tick from the renderer's own runtime, so no
 * row arms a timer of its own and a test advances the tick on a `TestClock`.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** The spans a row counts in, longest first, each with its letter; past the last, the row names the date. */
const SINCE_UNITS = [
  [WEEK, "w"],
  [DAY, "d"],
  [HOUR, "h"],
  [MINUTE, "m"],
] as const;

/** How old a plan may be and still be counted in weeks; an older one is named by its date. */
const WEEKS_COUNTED = 5 * WEEK;

const DAY_OF_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const DAY_WITH_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const MOMENT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const TIME_OF_DAY = new Intl.DateTimeFormat("en-US", { timeStyle: "short" });

/** What parts a span's start from its end. */
const SPAN_ARROW = " → ";

/**
 * How long ago `at` was, in a row's few letters: "now" inside a minute, then
 * "5m", "3h", "2d", "3w", and past four weeks the date, with its year only
 * where it is not this one.
 */
export function sinceText(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed >= WEEKS_COUNTED) {
    const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
    return (sameYear ? DAY_OF_YEAR : DAY_WITH_YEAR).format(at);
  }
  const unit = SINCE_UNITS.find(([span]) => elapsed >= span);
  return unit === undefined ? "now" : `${Math.floor(elapsed / unit[0])}${unit[1]}`;
}

/** The moment `at` in full, for the hover over a row's few letters. */
export function momentText(at: number): string {
  return MOMENT.format(at);
}

/** A span from one moment to another, each in full, the end's day left unsaid where it is the start's: "Oct 12, 2026, 2:32 PM → 2:41 PM". */
export function spanText(startedAt: number, endedAt: number): string {
  const sameDay = new Date(startedAt).toDateString() === new Date(endedAt).toDateString();
  const ended = sameDay ? TIME_OF_DAY.format(endedAt) : MOMENT.format(endedAt);
  return `${MOMENT.format(startedAt)}${SPAN_ARROW}${ended}`;
}

/** The time now, and again on every minute after, on whatever clock the stream runs under. */
const minuteTicks: Stream.Stream<number> = Stream.fromEffectSchedule(
  Clock.currentTimeMillis,
  Schedule.spaced(Duration.minutes(1)),
);

const minuteAtom = rendererRuntime.atom(minuteTicks);

/**
 * The time the sidebar's rows count from, moved on once a minute while any
 * row reads it. Note that the time read at the render stands in until the
 * tick's first reading lands, so a row never draws a blank.
 */
export function useMinute(): number {
  return AsyncResult.getOrElse(useAtomValue(minuteAtom), () => Date.now());
}
