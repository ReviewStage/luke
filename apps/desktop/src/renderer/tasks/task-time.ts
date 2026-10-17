import { useAtomValue } from "@effect/atom-react";
import { Clock, Duration, Schedule, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { rendererRuntime } from "../renderer-runtime";

/**
 * task-time.ts -- the window's one way of saying when: how long ago in a row's few letters or a line's words, a moment in full, a span, a call's day, and the minute that says it again.
 *
 * A row's word is the shortest a devtool's list uses: "now", then minutes,
 * hours, days, and weeks by their letter, and the date itself once a task is
 * a month old, so a glance down the column reads like Codex's and Cursor's.
 * A line that says it in words says the same with "ago" after a count, so a
 * task's "Edited by you · 3d ago" and its sidebar row's "3d" never part.
 * Every word is set in US English whatever the Mac's own region, since the
 * words around it are English, and in the Mac's own zone: a call's "Today,
 * 3:42 PM" and the "2:32 PM → 3:42 PM" its card hangs read one clock. The
 * words move on a minute's tick from the renderer's own runtime, so no row
 * arms a timer of its own and a test advances the tick on a `TestClock`.
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

/** How old a task may be and still be counted in weeks; an older one is named by its date. */
const WEEKS_COUNTED = 5 * WEEK;

/** The one locale every time is said in, the window's words being English. */
const LOCALE = "en-US";

const DAY_OF_YEAR = new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric" });
const DAY_WITH_YEAR = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const WEEKDAY = new Intl.DateTimeFormat(LOCALE, { weekday: "long" });
const DAY_AND_TIME = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const MOMENT = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" });
const TIME_OF_DAY = new Intl.DateTimeFormat(LOCALE, { timeStyle: "short" });

/** What parts a span's start from its end. */
const SPAN_ARROW = " → ";

/** What a row says inside a minute, and a line too, since "just now" would be a second word for it. */
const NOW_WORD = "now";

/** What a line says after a count of how long ago. */
const AGO_WORD = " ago";

/** A date as a row names it, with its year only where it is not `now`'s and the row has room for it. */
function dateText(at: number, now: number, year: boolean): string {
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return (sameYear || !year ? DAY_OF_YEAR : DAY_WITH_YEAR).format(at);
}

/** The local midnight a moment's day began at. */
function midnightOf(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** How long ago as a count and its letter: nothing under a minute, or once it is old enough to be named by its date. */
function sinceCount(elapsed: number): string | undefined {
  if (elapsed >= WEEKS_COUNTED) return undefined;
  const unit = SINCE_UNITS.find(([span]) => elapsed >= span);
  return unit === undefined ? undefined : `${Math.floor(elapsed / unit[0])}${unit[1]}`;
}

/**
 * How long ago `at` was, in a row's few letters: "now" inside a minute, then
 * "5m", "3h", "2d", "3w", and past four weeks the date, with its year only
 * where it is not this one, unless `year` is false for a place kept to a
 * fixed few letters, which says the full moment elsewhere.
 */
export function sinceText(at: number, now: number, { year = true } = {}): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed >= WEEKS_COUNTED) return dateText(at, now, year);
  return sinceCount(elapsed) ?? NOW_WORD;
}

/**
 * How long ago `at` was, as a line says it in words: the row's own word with
 * "ago" after a count, so "now", "5m ago", "3w ago", and past four weeks the
 * date, "Oct 1".
 */
export function agoText(at: number, now: number): string {
  const count = sinceCount(Math.max(0, now - at));
  return count === undefined ? sinceText(at, now) : `${count}${AGO_WORD}`;
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

/** A day and a time in the fewest words, as a version is named: "Oct 11, 2:14 PM". */
export function dayAndTimeText(at: number): string {
  return DAY_AND_TIME.format(at);
}

/** A day alone, with its year: "Oct 11, 2026". */
export function dayText(at: number): string {
  return DAY_WITH_YEAR.format(at);
}

/**
 * A call's header: the day, as today, yesterday, a weekday this week, or a
 * date, then the time on the clock its card reads: "Today, 3:42 PM".
 */
export function callHeading(startedAt: number, now: number): string {
  const daysAgo = Math.round((midnightOf(now) - midnightOf(startedAt)) / DAY);
  const time = TIME_OF_DAY.format(startedAt);
  if (daysAgo === 0) return `Today, ${time}`;
  if (daysAgo === 1) return `Yesterday, ${time}`;
  const day =
    daysAgo > 1 && daysAgo < 7 ? WEEKDAY.format(startedAt) : dateText(startedAt, now, true);
  return `${day}, ${time}`;
}

/** The time now, and again on every minute after, on whatever clock the stream runs under. */
const minuteTicks: Stream.Stream<number> = Stream.fromEffectSchedule(
  Clock.currentTimeMillis,
  Schedule.spaced(Duration.minutes(1)),
);

const minuteAtom = rendererRuntime.atom(minuteTicks);

/**
 * The time the window's times count from, moved on once a minute while any
 * of them reads it. Note that the time read at the render stands in until the
 * tick's first reading lands, so a row never draws a blank.
 */
export function useMinute(): number {
  return AsyncResult.getOrElse(useAtomValue(minuteAtom), () => Date.now());
}
