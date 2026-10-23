/**
 * time-format.ts -- every app's one way of saying when and how many, with no DOM: how long ago in a row's few letters or a line's words, a moment in full, a span, a call's day, how long a run has gone, a calendar day, and a count.
 *
 * A row's word is the shortest a devtool's list uses: "now", then minutes,
 * hours, days, and weeks by their letter, and the date itself once a task is
 * a month old, so a glance down the column reads like Codex's and Cursor's.
 * A line that says it in words says the same with "ago" after a count, so a
 * task's "Edited by you · 3d ago" and its sidebar row's "3d" never part.
 * Every word is set in US English whatever the Mac's own region, since the
 * words around it are English, and in the Mac's own zone: a call's "Today,
 * 3:42 PM" and the "2:32 PM → 3:42 PM" its card hangs read one clock. The
 * `Time` (`components/time`) draws these and moves them on the minute's or the
 * second's tick, so no row arms a timer of its own.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const SECOND = 1_000;
const MINUTE_SECONDS = 60;
const HOUR_MINUTES = 60;

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
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

/** A count as every list says it, grouped by thousands: "1,234". */
const COUNT = new Intl.NumberFormat(LOCALE);

/** A count grouped as the reader's own region groups it, which no locale is named for. */
const LOCAL_COUNT = new Intl.NumberFormat();

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

/** What separates how long a turn worked from when it ended, and a call's heading from its length. */
export const WORKED_SEPARATOR = " · ";

/** How long a run has gone, as devtools count it: "42s" under a minute, "1m 12s" under an hour, and "1h 3m" past it. */
export function workingTime(elapsedMs: number): string {
  const seconds = Math.floor(Math.max(0, elapsedMs) / SECOND);
  if (seconds < MINUTE_SECONDS) return `${seconds}s`;
  const minutes = Math.floor(seconds / MINUTE_SECONDS);
  if (minutes < HOUR_MINUTES) return `${minutes}m ${seconds % MINUTE_SECONDS}s`;
  return `${Math.floor(minutes / HOUR_MINUTES)}h ${minutes % HOUR_MINUTES}m`;
}

/** A count grouped by thousands in the window's English, as the admin page says it: "1,234". */
export function formatCount(value: number): string {
  return COUNT.format(value);
}

/** A count grouped in the reader's own locale, as `toLocaleString()` said it: "1.234" in Germany. */
export function formatLocaleCount(value: number): string {
  return LOCAL_COUNT.format(value);
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

/** The zone this machine is in. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
