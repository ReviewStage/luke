/**
 * time-format.ts -- every app's one way of saying when and how many, with no DOM: how long ago in a row's few letters or a line's words, a moment in full, a span, a call's day, how long a run has gone, a calendar day, a clock, and a playhead.
 *
 * A row's word is the shortest a devtool's list uses: "now", then minutes,
 * hours, days, and weeks by their letter, and the date itself once a task is
 * a month old, so a glance down the column reads like Codex's and Cursor's.
 * A line that says it in words says the same with "ago" after a count, so a
 * task's "Edited by you · 3d ago" and its sidebar row's "3d" never part.
 * Every word is set in US English whatever the Mac's own region, since the
 * words around it are English, and in the Mac's own zone: a call's "Today,
 * 3:42 PM" and the "2:32 PM → 3:42 PM" its card hangs read one clock.
 *
 * Note that every clock is a 12-hour one, a schedule's included, because
 * Chromium's `Intl` takes its hour cycle from the language alone and gives no
 * way to read the Mac's 24-hour setting, so following the system would only
 * mean following the locale, which is pinned to English. A time a field holds
 * ("14:05") is a value, never a label. The `Time` (`components/time` in
 * `@luke/ui`) draws these and moves them on the minute's or the second's
 * tick, so no row arms a timer of its own. Numbers are `number-format.ts`'s.
 */

import { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS } from "@luke/runtime/vocabulary";

const WEEK_MS = 7 * DAY_MS;
const MINUTE_SECONDS = 60;
const HOUR_MINUTES = 60;

/** The spans a row counts in, longest first, each with its letter; past the last, the row names the date. */
const SINCE_UNITS = [
  [WEEK_MS, "w"],
  [DAY_MS, "d"],
  [HOUR_MS, "h"],
  [MINUTE_MS, "m"],
] as const;

/** How old a task may be and still be counted in weeks; an older one is named by its date. */
const WEEKS_COUNTED = 5 * WEEK_MS;

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
const WEEKDAY_AND_TIME = new Intl.DateTimeFormat(LOCALE, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** Calendar days and instants named in UTC, as the admin page and the changelog name them: a day is a calendar day, not an instant. */
const UTC_DAY = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeZone: "UTC" });
const UTC_DAY_TICK = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const UTC_DAY_HEADING = new Intl.DateTimeFormat(LOCALE, { dateStyle: "long", timeZone: "UTC" });
const UTC_INSTANT = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

/** What parts a span's start from its end. */
const SPAN_ARROW = " → ";

/** What a row says inside a minute, and a line too, since "just now" would be a second word for it. */
const NOW_WORD = "now";

/** The spans a date's distance counts in, longest first, each with its letter. */
const DISTANCE_UNITS = [
  [DAY_MS, "d"],
  [HOUR_MS, "h"],
  [MINUTE_MS, "m"],
] as const;

/** What a line says before a count of how long from now. */
const AHEAD_WORD = "in ";

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

/**
 * How far `deltaMs` stands from now, as a line says it in the row's letters:
 * "in 3h" ahead, "3h ago" behind, "now" inside a minute, and days past a
 * day however many, since a date's card has no week to count in.
 */
export function distanceText(deltaMs: number): string {
  const size = Math.abs(deltaMs);
  const unit = DISTANCE_UNITS.find(([span]) => size >= span);
  if (unit === undefined) return NOW_WORD;
  const count = `${Math.floor(size / unit[0])}${unit[1]}`;
  return deltaMs > 0 ? `${AHEAD_WORD}${count}` : `${count}${AGO_WORD}`;
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

/** A moment's weekday and time of day: "Mon 2:05 PM". */
export function weekdayAndTimeText(at: number): string {
  return WEEKDAY_AND_TIME.format(at);
}

/** A time of day a schedule names by its hour (0 to 23) and minute, on the 12-hour clock: "2:05 PM". */
export function clockText(hour: number, minute: number): string {
  const half = hour < 12 ? "AM" : "PM";
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")} ${half}`;
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
  const daysAgo = Math.round((midnightOf(now) - midnightOf(startedAt)) / DAY_MS);
  const time = TIME_OF_DAY.format(startedAt);
  if (daysAgo === 0) return `Today, ${time}`;
  if (daysAgo === 1) return `Yesterday, ${time}`;
  const day =
    daysAgo > 1 && daysAgo < 7 ? WEEKDAY.format(startedAt) : dateText(startedAt, now, true);
  return `${day}, ${time}`;
}

/** What separates how long a turn worked from when it ended, and a call's heading from its length. */
export const WORKED_SEPARATOR = " · ";

/** How long a run has gone, as devtools count it: "42s" under a minute, "1m 12s" under an hour, and "1h 3m" past it. */
export function workingTime(elapsedMs: number): string {
  const seconds = Math.floor(Math.max(0, elapsedMs) / SECOND_MS);
  if (seconds < MINUTE_SECONDS) return `${seconds}s`;
  const minutes = Math.floor(seconds / MINUTE_SECONDS);
  if (minutes < HOUR_MINUTES) return `${minutes}m ${seconds % MINUTE_SECONDS}s`;
  return `${Math.floor(minutes / HOUR_MINUTES)}h ${minutes % HOUR_MINUTES}m`;
}

/** How far a recording or a video has run, as a player says it: minutes and two-digit seconds, "1:12". */
export function playheadText(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / SECOND_MS);
  return `${Math.floor(seconds / MINUTE_SECONDS)}:${String(seconds % MINUTE_SECONDS).padStart(2, "0")}`;
}

/** An instant drawn as its UTC date alone, e.g. "Aug 3, 2026". */
export function formatDate(epochMs: number): string {
  return UTC_DAY.format(epochMs);
}

/** An instant drawn as its UTC date and time, e.g. "Oct 21, 12:04 UTC". */
export function formatInstant(epochMs: number): string {
  return `${UTC_INSTANT.format(epochMs)} UTC`;
}

/** A day key ("2026-08-21") drawn as a short axis tick, e.g. "Aug 21". */
export function formatDayTick(day: string): string {
  return UTC_DAY_TICK.format(new Date(`${day}T00:00:00.000Z`));
}

/** A day key drawn as a page's own masthead, e.g. "August 21, 2026". */
export function formatDayHeading(day: string): string {
  return UTC_DAY_HEADING.format(new Date(`${day}T00:00:00.000Z`));
}

/** Every time zone this machine knows, as a zone menu lists them. */
export function timeZoneNames(): readonly string[] {
  return Intl.supportedValuesOf("timeZone");
}
