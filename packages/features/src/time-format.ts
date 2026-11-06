import { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS } from "@repo/runtime/vocabulary";

const WEEK_MS = 7 * DAY_MS;
const MINUTE_SECONDS = 60;
const HOUR_MINUTES = 60;
const DAY_HOURS = 24;

const DAYS_COUNTED_PAST = 2;

const SINCE_UNITS = [
  [WEEK_MS, "w"],
  [DAY_MS, "d"],
  [HOUR_MS, "h"],
  [MINUTE_MS, "m"],
] as const;

const WEEKS_COUNTED = 5 * WEEK_MS;

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

const SPAN_DASH = " – ";

const NOW_WORD = "now";

const DISTANCE_UNITS = [
  [DAY_MS, "d"],
  [HOUR_MS, "h"],
  [MINUTE_MS, "m"],
] as const;

const AHEAD_WORD = "in ";

const AGO_WORD = " ago";

function dateText(at: number, now: number, year: boolean): string {
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return (sameYear || !year ? DAY_OF_YEAR : DAY_WITH_YEAR).format(at);
}

function midnightOf(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function sinceCount(elapsed: number): string | undefined {
  if (elapsed >= WEEKS_COUNTED) return undefined;
  const unit = SINCE_UNITS.find(([span]) => elapsed >= span);
  return unit === undefined ? undefined : `${Math.floor(elapsed / unit[0])}${unit[1]}`;
}

export function sinceText(at: number, now: number, { year = true } = {}): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed >= WEEKS_COUNTED) return dateText(at, now, year);
  return sinceCount(elapsed) ?? NOW_WORD;
}

export function agoText(at: number, now: number): string {
  const count = sinceCount(Math.max(0, now - at));
  return count === undefined ? sinceText(at, now) : `${count}${AGO_WORD}`;
}

export function provenanceText(at: number, now: number): string {
  return now - at < WEEK_MS ? agoText(at, now) : dateOfText(at, now);
}

export function momentText(at: number): string {
  return MOMENT.format(at);
}

export function distanceText(deltaMs: number): string {
  const size = Math.abs(deltaMs);
  const unit = DISTANCE_UNITS.find(([span]) => size >= span);
  if (unit === undefined) return NOW_WORD;
  const count = `${Math.floor(size / unit[0])}${unit[1]}`;
  return deltaMs > 0 ? `${AHEAD_WORD}${count}` : `${count}${AGO_WORD}`;
}

export function dueText(at: number, now: number): string {
  if (midnightOf(at) === midnightOf(now)) return TIME_OF_DAY.format(at);
  return at > now && at - now < WEEK_MS ? WEEKDAY_AND_TIME.format(at) : dateText(at, now, true);
}

export function dayAndTimeText(at: number): string {
  return DAY_AND_TIME.format(at);
}

export function weekdayAndTimeText(at: number): string {
  return WEEKDAY_AND_TIME.format(at);
}

export function clockText(hour: number, minute: number): string {
  const half = hour < 12 ? "AM" : "PM";
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")} ${half}`;
}

export function dateOfText(at: number, now: number): string {
  return dateText(at, now, true);
}

export function dayText(at: number): string {
  return DAY_WITH_YEAR.format(at);
}

function dayWord(at: number, now: number): string {
  const daysAgo = Math.round((midnightOf(now) - midnightOf(at)) / DAY_MS);
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return daysAgo > 1 && daysAgo < 7 ? WEEKDAY.format(at) : dateText(at, now, true);
}

export function callHeading(startedAt: number, now: number): string {
  return `${dayWord(startedAt, now)}, ${TIME_OF_DAY.format(startedAt)}`;
}

export const WORKED_SEPARATOR = " · ";

function twoUnits(large: number, largeUnit: string, small: number, smallUnit: string): string {
  return small === 0 ? `${large}${largeUnit}` : `${large}${largeUnit} ${small}${smallUnit}`;
}

export function workingTime(elapsedMs: number): string {
  const seconds = Math.floor(Math.max(0, elapsedMs) / SECOND_MS);
  if (seconds < MINUTE_SECONDS) return `${seconds}s`;
  const minutes = Math.floor(seconds / MINUTE_SECONDS);
  if (minutes < HOUR_MINUTES) return twoUnits(minutes, "m", seconds % MINUTE_SECONDS, "s");
  const hours = Math.floor(minutes / HOUR_MINUTES);
  if (hours < DAYS_COUNTED_PAST * DAY_HOURS)
    return twoUnits(hours, "h", minutes % HOUR_MINUTES, "m");
  return twoUnits(Math.floor(hours / DAY_HOURS), "d", hours % DAY_HOURS, "h");
}

export function runSpanText(startedAt: number, endedAt: number, now: number): string {
  const sameDay = midnightOf(startedAt) === midnightOf(endedAt);
  const clock = TIME_OF_DAY.formatRange(startedAt, endedAt).replace(/[\u2009\u202f]/gu, " ");
  const span = sameDay
    ? `${dayWord(startedAt, now)}, ${clock}`
    : `${callHeading(startedAt, now)}${SPAN_DASH}${callHeading(endedAt, now)}`;
  return `${span}${WORKED_SEPARATOR}${workingTime(endedAt - startedAt)}`;
}

export function playheadText(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / SECOND_MS);
  return `${Math.floor(seconds / MINUTE_SECONDS)}:${String(seconds % MINUTE_SECONDS).padStart(2, "0")}`;
}

export function formatDate(epochMs: number): string {
  return UTC_DAY.format(epochMs);
}

export function formatInstant(epochMs: number): string {
  return `${UTC_INSTANT.format(epochMs)} UTC`;
}

export function formatDayTick(day: string): string {
  return UTC_DAY_TICK.format(new Date(`${day}T00:00:00.000Z`));
}

export function formatDayHeading(day: string): string {
  return UTC_DAY_HEADING.format(new Date(`${day}T00:00:00.000Z`));
}

export function timeZoneNames(): readonly string[] {
  return Intl.supportedValuesOf("timeZone");
}
