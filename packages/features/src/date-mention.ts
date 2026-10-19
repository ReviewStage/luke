import { SCHEMA_REFUSAL } from "@luke/wire";
import { wireRefusal } from "@luke/wire/effect";
import { DateTime, Option, Schema } from "effect";

/**
 * date-mention.ts -- a date a mention names: a day, a time on one, or a range of either, read from the words typed after an `@`, and said as its written label, its chip's words, and its card's.
 *
 * A date is held as Notion holds one, a start and perhaps an end, each in
 * ISO 8601: a day alone, `2026-10-20`, which names the same day wherever it
 * is read, or a time on a day with the offset it was written at,
 * `2026-10-20T15:00-07:00`, which names one instant. A range's two ends are
 * both days or both times, its end after its start.
 *
 * Its written label is the date in full, `Oct 20, 2026` or `Oct 20, 2026,
 * 3:00 PM PDT`, so the words read as the date wherever they are read, an
 * agent's prompt or a pull request among them, and never go stale. Its chip
 * says it from where the reader stands, in the reader's own zone and on the
 * reader's own day: Today, Tomorrow, Friday, Oct 20. Every word is US
 * English, as the window's are (`task-time.ts`).
 *
 * The words an `@` reads as a date are a short list people type, not a
 * language: a named day (`today`, `tomorrow`, `yesterday`), a weekday,
 * `this`, `next`, or `last` one, `next week` and `next month`, a count of
 * days, weeks, or months from today, a month and its day, an ISO day, and
 * a US month/day, each with a time after it or not (`3pm`, `at 9:30am`,
 * `15:00`, `noon`), and two of them joined by `to`, `until`, `-`, or `→`
 * for a range, the second perhaps a time alone on the first's day, or a
 * day of the month alone after a day (`oct 20 to 24`). A word
 * only partly typed reads as the day it can only be, once enough of it
 * stands to tell it from a name (`tomo`, `fri`).
 */

const LOCALE = "en-US";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** A day as a date mention spells it. */
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** A time on a day as a date mention spells it, to the minute, with its offset. */
const TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})([+-])(\d{2}):(\d{2})$/u;

/** The widest offset a zone is ever set at, in hours. */
const MAX_OFFSET_HOURS = 14;

/** The most characters of a time zone's name a client may send; the longest IANA name is 32. */
const MAX_ZONE_CHARS = 64;

/** The named days, each with how far from today it stands and how much of it must be typed to be read. */
const NAMED_DAYS = [
  { word: "today", shift: 0, least: 3 },
  { word: "tomorrow", shift: 1, least: 4 },
  { word: "yesterday", shift: -1, least: 3 },
] as const;

/** Tomorrow's short spellings. */
const TOMORROW_SHORT: ReadonlySet<string> = new Set(["tmr", "tmrw"]);

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

/** How much of a weekday's or a month's name must be typed to be read as it. */
const LEAST_NAME = 3;

/** The most characters of words read for a date; an `@` word is six words at most, so any longer is no date. */
const MAX_WORDS_CHARS = 80;

/** The words that join a range's two ends, in words whose spaces are single. */
const RANGE_JOIN = / (?:to|until|-|–|→) | ?→ ?/u;

/** A time of day, perhaps after `at`, ending words whose spaces are single: `3pm`, `9:30 am`, `15:00`, `noon`, `midnight`. */
const TRAILING_TIME =
  /(?:^| )(?:at )?(?:(\d{1,2})(?::(\d{2}))? ?(am|pm|a|p)|(\d{1,2}):(\d{2})|(noon|midnight))$/u;

/** What the chip and the label say between a range's ends. */
const RANGE_ARROW = " → ";

/** A date as a mention holds it: a start, and an end where it is a range. */
export interface DateSpan {
  readonly start: string;
  readonly end?: string;
}

/** A calendar day, as the parser counts in it. */
interface Day {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** A time of day. */
interface Clock {
  readonly hour: number;
  readonly minute: number;
}

/** One end of a range as read: its day, and its time where the words named one. */
interface Moment {
  readonly day: Day;
  readonly clock: Clock | undefined;
}

/** A day as an ISO day spells it. */
function isoDay(day: Day): string {
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  return `${pad(day.year, 4)}-${pad(day.month, 2)}-${pad(day.day, 2)}`;
}

/** The day `year`, `month`, `day` names, or nothing where the calendar has no such day. */
function realDay(year: number, month: number, day: number): Day | undefined {
  if (year < 1000 || year > 9999) return undefined;
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day
    ? { year, month, day }
    : undefined;
}

/** A day's midnight in UTC, which counts days without a zone. */
function utcOf(day: Day): number {
  return Date.UTC(day.year, day.month - 1, day.day);
}

/** The day a UTC midnight falls on. */
function dayOfUtc(at: number): Day {
  const date = new Date(at);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** The day `count` days from `day`. */
function shifted(day: Day, count: number): Day {
  return dayOfUtc(utcOf(day) + count * DAY_MS);
}

/** The day `count` months from `day`, on its last day where the month is shorter. */
function monthsOn(day: Day, count: number): Day {
  const first = new Date(Date.UTC(day.year, day.month - 1 + count, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return dayOfUtc(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day.day, last)));
}

/** A day's weekday, Sunday as 0. */
function weekdayOf(day: Day): number {
  return new Date(utcOf(day)).getUTCDay();
}

/** How many days `day` stands after `from`, before it where negative. */
function daysBetween(from: Day, day: Day): number {
  return Math.round((utcOf(day) - utcOf(from)) / DAY_MS);
}

/** The day an ISO day names, or nothing where it is no day. */
function dayOfIso(iso: string): Day | undefined {
  const match = DAY_PATTERN.exec(iso);
  if (match === null) return undefined;
  return realDay(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** The day it is at `now` in `zone`. */
function todayIn(now: number, zone: string): Day | undefined {
  const zoned = DateTime.makeZoned(now, { timeZone: zone });
  return Option.isNone(zoned) ? undefined : dayOfIso(DateTime.formatIsoDate(zoned.value));
}

/** The index of the name the word starts, typed far enough to be told from any other word; -1 for none. */
function nameIndex(names: readonly string[], word: string): number {
  if (word.length < LEAST_NAME) return -1;
  return names.findIndex((name) => name.startsWith(word));
}

/** The nearest `month`/`day` to `today`, a year before or after where that one is nearer. */
function nearestDay(today: Day, month: number, day: number): Day | undefined {
  const near = [today.year - 1, today.year, today.year + 1]
    .map((year) => realDay(year, month, day))
    .filter((each): each is Day => each !== undefined)
    .sort((a, b) => Math.abs(daysBetween(today, a)) - Math.abs(daysBetween(today, b)));
  return near[0];
}

/** A year as written, two digits read in this century. */
function yearOf(written: string): number {
  return written.length === 2 ? 2000 + Number(written) : Number(written);
}

/** A weekday after `this`, `next`, or `last`, or alone: the next after today, the one in next week, or the last before today. */
function weekdayDay(today: Day, which: string | undefined, weekday: number): Day {
  const now = weekdayOf(today);
  if (which === "last") return shifted(today, -((now - weekday + 7) % 7 || 7));
  if (which === "next") {
    // Note that weeks start on Monday, so next Friday is the Friday of the week after this one.
    const monday = shifted(today, -((now + 6) % 7));
    return shifted(monday, 7 + ((weekday + 6) % 7));
  }
  return shifted(today, (weekday - now + 7) % 7 || 7);
}

/** A named day, read from as much of it as was typed. */
function namedDay(words: string, today: Day): Day | undefined {
  if (TOMORROW_SHORT.has(words)) return shifted(today, 1);
  const named = NAMED_DAYS.find(
    (each) => words.length >= each.least && each.word.startsWith(words),
  );
  return named === undefined ? undefined : shifted(today, named.shift);
}

/** A weekday, `next week`, or `next month`. */
function weekDay(words: string, today: Day): Day | undefined {
  const week = /^next (week|month)$/u.exec(words);
  if (week !== null) {
    return week[1] === "week"
      ? weekdayDay(today, undefined, 1)
      : dayOfUtc(Date.UTC(today.year, today.month, 1));
  }
  const weekday = /^(?:(this|next|last) )?([a-z]+)$/u.exec(words);
  if (weekday === null) return undefined;
  const index = nameIndex(WEEKDAYS, weekday[2] ?? "");
  return index === -1 ? undefined : weekdayDay(today, weekday[1], index);
}

/** A count of days, weeks, or months from today: `in 3 days`, `in 2w`, `3 days ago`. */
function countedDay(words: string, today: Day): Day | undefined {
  const ahead = /^in (\d{1,3}) ?(d|days?|w|weeks?|m|mo|months?)?$/u.exec(words);
  if (ahead !== null) {
    const count = Number(ahead[1]);
    const unit = (ahead[2] ?? "d")[0];
    if (unit === "m") return monthsOn(today, count);
    return shifted(today, unit === "w" ? 7 * count : count);
  }
  const ago = /^(\d{1,3}) (days?|weeks?) ago$/u.exec(words);
  if (ago === null) return undefined;
  return shifted(today, -Number(ago[1]) * (ago[2]?.startsWith("w") ? 7 : 1));
}

/** A month and its day, either way about, perhaps with a year: `oct 20`, `20 october 2027`. */
function monthDay(words: string, today: Day): Day | undefined {
  const first = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/u.exec(words);
  const second = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?(?: (\d{4}))?$/u.exec(words);
  const name = first?.[1] ?? second?.[2];
  const day = first?.[2] ?? second?.[1];
  const year = first?.[3] ?? second?.[3];
  if (name === undefined || day === undefined) return undefined;
  const month = nameIndex(MONTHS, name) + 1;
  if (month === 0) return undefined;
  return year === undefined
    ? nearestDay(today, month, Number(day))
    : realDay(Number(year), month, Number(day));
}

/** An ISO day, or a US month/day perhaps with its year. */
function numericDay(words: string, today: Day): Day | undefined {
  const iso = dayOfIso(words);
  if (iso !== undefined) return iso;
  const us = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/u.exec(words);
  if (us === null) return undefined;
  const month = Number(us[1]);
  const day = Number(us[2]);
  return us[3] === undefined ? nearestDay(today, month, day) : realDay(yearOf(us[3]), month, day);
}

/** The day the words name, counted from `today`; nothing where they name none. */
function dayOfWords(words: string, today: Day): Day | undefined {
  return (
    namedDay(words, today) ??
    weekDay(words, today) ??
    countedDay(words, today) ??
    monthDay(words, today) ??
    numericDay(words, today)
  );
}

/** A time of day from its hour, its minutes, and its half of the day, where it names one. */
function clockOf(hour: number, minute: number, half: string | undefined): Clock | undefined {
  if (minute > 59) return undefined;
  if (half === undefined) return hour > 23 ? undefined : { hour, minute };
  if (hour < 1 || hour > 12) return undefined;
  const pm = half.startsWith("p");
  return { hour: (hour % 12) + (pm ? 12 : 0), minute };
}

/** The words split into a day's and a time's, where they end in a time. */
function splitTime(words: string): { readonly rest: string; readonly clock: Clock } | undefined {
  const match = TRAILING_TIME.exec(words);
  if (match === null) return undefined;
  const [, hour12, minute12, half, hour24, minute24, named] = match;
  const rest = words.slice(0, match.index);
  const clock =
    named !== undefined
      ? { hour: named === "noon" ? 12 : 0, minute: 0 }
      : hour12 !== undefined
        ? clockOf(Number(hour12), Number(minute12 ?? "0"), half)
        : clockOf(Number(hour24), Number(minute24), undefined);
  return clock === undefined ? undefined : { rest: rest.trim(), clock };
}

/** A range's end written as its day of the month alone, `oct 20 to 24`: that day in its start's month, or the next month's where it is not after the start. */
function dayAfter(words: string, start: Day): Day | undefined {
  const bare = /^(\d{1,2})(?:st|nd|rd|th)?$/u.exec(words);
  if (bare === null) return undefined;
  const day = Number(bare[1]);
  const same = realDay(start.year, start.month, day);
  if (same !== undefined && daysBetween(start, same) > 0) return same;
  const next = monthsOn({ ...start, day: 1 }, 1);
  return realDay(next.year, next.month, day);
}

/** One end of a range: a day and perhaps a time, a time alone standing on `alone`, today where it is not a range's end. */
function momentOf(words: string, today: Day, alone: Day): Moment | undefined {
  const timed = splitTime(words);
  if (timed === undefined) {
    const day = dayOfWords(words, today);
    return day === undefined ? undefined : { day, clock: undefined };
  }
  const day = timed.rest === "" ? alone : dayOfWords(timed.rest, today);
  return day === undefined ? undefined : { day, clock: timed.clock };
}

/** A moment spelled as a mention holds it: its day, or its time in `zone` with the offset the zone stands at then. */
function spelled(moment: Moment, zone: string): string | undefined {
  const day = isoDay(moment.day);
  if (moment.clock === undefined) return day;
  const zoned = DateTime.makeZoned(
    { ...moment.day, hour: moment.clock.hour, minute: moment.clock.minute },
    { timeZone: zone, adjustForTimeZone: true },
  );
  if (Option.isNone(zoned)) return undefined;
  const parts = DateTime.toParts(zoned.value);
  const pad = (value: number) => String(value).padStart(2, "0");
  const wall = `${isoDay(parts)}T${pad(parts.hour)}:${pad(parts.minute)}`;
  return `${wall}${DateTime.zonedOffsetIso(zoned.value)}`;
}

/** The instant a time names, or a day's UTC midnight, to order a range's ends by. */
function instantOf(moment: string): number {
  const time = TIME_PATTERN.exec(moment);
  if (time === null) return utcOf(dayOfIso(moment) ?? { year: 0, month: 1, day: 1 });
  return Date.parse(moment);
}

/** Whether a moment is spelled as a mention holds one, and names a real day and time. */
export function isDateMoment(moment: string): boolean {
  if (dayOfIso(moment) !== undefined) return true;
  const time = TIME_PATTERN.exec(moment);
  if (time === null) return false;
  const [, year, month, day, hour, minute, , offsetHours, offsetMinutes] = time;
  return (
    realDay(Number(year), Number(month), Number(day)) !== undefined &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(offsetHours) <= MAX_OFFSET_HOURS &&
    Number(offsetMinutes) <= 59
  );
}

/** Whether a moment names a time rather than a whole day. */
function isTimed(moment: string): boolean {
  return TIME_PATTERN.test(moment);
}

/** Whether a range's ends are both days or both times, its end after its start. */
export function isDateRange(start: string, end: string): boolean {
  return (
    isDateMoment(start) &&
    isDateMoment(end) &&
    isTimed(start) === isTimed(end) &&
    instantOf(end) > instantOf(start)
  );
}

/**
 * The date the words typed after an `@` name, counted from `now` in the
 * reader's `zone`, a time spelled with the offset `zone` stands at then;
 * nothing where the words name no date, or a range whose ends are not both
 * days or both times, or whose end is not after its start.
 */
export function dateOfWords(words: string, now: number, zone: string): DateSpan | undefined {
  if (words.length > MAX_WORDS_CHARS) return undefined;
  const typed = words.trim().toLowerCase().replace(/,/gu, " ").replace(/\s+/gu, " ");
  const today = todayIn(now, zone);
  if (typed === "" || today === undefined) return undefined;
  const [first = "", second, ...more] = typed.split(RANGE_JOIN);
  if (more.length > 0) return undefined;
  const start = momentOf(first, today, today);
  if (start === undefined) return undefined;
  const from = spelled(start, zone);
  if (from === undefined || second === undefined)
    return from === undefined ? undefined : { start: from };
  const shortened = start.clock === undefined ? dayAfter(second, start.day) : undefined;
  // Note that an end read from today that falls before the start is read again from the start, so on a Saturday `fri to mon` runs from Friday to the Monday after it.
  const to = [today, start.day]
    .map((counted) =>
      shortened === undefined
        ? momentOf(second, counted, start.day)
        : { day: shortened, clock: undefined },
    )
    .map((end) => (end === undefined ? undefined : spelled(end, zone)))
    .find((end) => end !== undefined && isDateRange(from, end));
  return to === undefined ? undefined : { start: from, end: to };
}

/** The dates a list narrowed to dates offers before a word is typed: today, tomorrow, and next Monday. */
export function suggestedDates(now: number, zone: string): readonly DateSpan[] {
  const today = todayIn(now, zone);
  if (today === undefined) return [];
  return [today, shifted(today, 1), weekdayDay(today, undefined, 1)].map((day) => ({
    start: isoDay(day),
  }));
}

/** A moment's day and time as `zone` reads them, a day alone as its own; nothing where it is no moment. */
function wallOf(moment: string, zone: string): Moment | undefined {
  const day = dayOfIso(moment);
  if (day !== undefined) return { day, clock: undefined };
  if (!isDateMoment(moment)) return undefined;
  const zoned = DateTime.makeZoned(Date.parse(moment), { timeZone: zone });
  if (Option.isNone(zoned)) return undefined;
  const parts = DateTime.toParts(zoned.value);
  return {
    day: { year: parts.year, month: parts.month, day: parts.day },
    clock: { hour: parts.hour, minute: parts.minute },
  };
}

/** The zone a time's own offset is, as Intl names one: `+05:30`; UTC for none. */
function offsetZone(moment: string): string {
  const time = TIME_PATTERN.exec(moment);
  if (time === null) return "UTC";
  return `${time[6]}${time[7]}:${time[8]}`;
}

/** A day in words, set in UTC since a day names no zone. */
function dayWords(day: Day, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: "UTC" }).format(utcOf(day));
}

/** A time in words as `zone` reads it, its zone's short name after it where asked. */
function timeWords(moment: string, zone: string, named: boolean): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  };
  if (named) options.timeZoneName = "short";
  return new Intl.DateTimeFormat(LOCALE, options).format(Date.parse(moment));
}

/** Whether two moments fall on one day as `zone` reads them. */
function sameDay(start: string, end: string, zone: string): boolean {
  const a = wallOf(start, zone);
  const b = wallOf(end, zone);
  return a !== undefined && b !== undefined && daysBetween(a.day, b.day) === 0;
}

/** A moment in full as `zone` reads it: its day with its year, and its time with the zone's name. */
function momentLabel(moment: string, zone: string): string {
  const wall = wallOf(moment, zone);
  if (wall === undefined) return moment;
  const day = dayWords(wall.day, { month: "short", day: "numeric", year: "numeric" });
  return wall.clock === undefined ? day : `${day}, ${timeWords(moment, zone, true)}`;
}

/**
 * The words a date mention is written with: each end in full, a time in
 * `zone`, its name after it, or the zone its own offset is where none is
 * given, and a range's end on its start's day by its time alone.
 */
export function dateLabel(span: DateSpan, zone?: string): string {
  const at = zone ?? offsetZone(span.start);
  const start = momentLabel(span.start, at);
  if (span.end === undefined) return start;
  const end =
    isTimed(span.end) && sameDay(span.start, span.end, at)
      ? timeWords(span.end, at, true)
      : momentLabel(span.end, zone ?? offsetZone(span.end));
  return `${start}${RANGE_ARROW}${end}`;
}

/** A day as the chip says it from `today`: a named day, a weekday this week or last, else the date, its year where it is not this one. */
function relativeDay(day: Day, today: Day): string {
  const count = daysBetween(today, day);
  const named = NAMED_DAYS.find((each) => each.shift === count);
  if (named !== undefined) return `${named.word.charAt(0).toUpperCase()}${named.word.slice(1)}`;
  const weekday = dayWords(day, { weekday: "long" });
  if (count >= 2 && count <= 6) return weekday;
  if (count <= -2 && count >= -6) return `Last ${weekday}`;
  return day.year === today.year
    ? dayWords(day, { month: "short", day: "numeric" })
    : dayWords(day, { month: "short", day: "numeric", year: "numeric" });
}

/** A moment as the chip says it from `today` in `zone`: its day, then its time. */
function relativeMoment(moment: string, today: Day, zone: string): string {
  const wall = wallOf(moment, zone);
  if (wall === undefined) return moment;
  const day = relativeDay(wall.day, today);
  return wall.clock === undefined ? day : `${day} ${timeWords(moment, zone, false)}`;
}

/**
 * What a date's chip says, from `now` in the reader's `zone`: Today,
 * Tomorrow, Friday, Last Friday, Oct 20, with the time after it where it
 * names one, and a range's end on its start's day by its time alone.
 */
export function dateChipText(span: DateSpan, now: number, zone: string): string {
  const today = todayIn(now, zone);
  if (today === undefined) return dateLabel(span);
  const start = relativeMoment(span.start, today, zone);
  if (span.end === undefined) return start;
  const end =
    isTimed(span.end) && sameDay(span.start, span.end, zone)
      ? timeWords(span.end, zone, false)
      : relativeMoment(span.end, today, zone);
  return `${start}${RANGE_ARROW}${end}`;
}

/** A moment in full words as `zone` reads it, for a card: `Tuesday, October 20, 2026 at 3:00 PM PDT`. */
function momentWhole(moment: string, zone: string): string {
  const wall = wallOf(moment, zone);
  if (wall === undefined) return moment;
  const day = dayWords(wall.day, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return wall.clock === undefined ? day : `${day} at ${timeWords(moment, zone, true)}`;
}

/** A date in full words as the reader's `zone` reads it, for its card. */
export function dateWhole(span: DateSpan, zone: string): string {
  const start = momentWhole(span.start, zone);
  return span.end === undefined ? start : `${start}${RANGE_ARROW}${momentWhole(span.end, zone)}`;
}

/** A count and its noun, `in` before it or `ago` after it. */
function away(count: number, unit: string): string {
  const size = Math.abs(count);
  const noun = `${size} ${unit}${size === 1 ? "" : "s"}`;
  return count > 0 ? `in ${noun}` : `${noun} ago`;
}

/**
 * How far a date's start stands from `now`, for its card: a day by days,
 * today, tomorrow, and yesterday by name; a time by minutes inside the
 * hour, by hours inside the day, else by days.
 */
export function dateDistance(span: DateSpan, now: number, zone: string): string {
  const today = todayIn(now, zone);
  const wall = wallOf(span.start, zone);
  if (today === undefined || wall === undefined) return "";
  const days = daysBetween(today, wall.day);
  if (isTimed(span.start)) {
    const ahead = Date.parse(span.start) - now;
    if (Math.abs(ahead) < MINUTE_MS) return "now";
    if (Math.abs(ahead) < HOUR_MS) return away(Math.trunc(ahead / MINUTE_MS), "minute");
    if (Math.abs(ahead) < DAY_MS) return away(Math.trunc(ahead / HOUR_MS), "hour");
  }
  const named = NAMED_DAYS.find((each) => each.shift === days);
  return named === undefined ? away(days, "day") : named.word;
}

/** The zone the reader's clock reads in, as the runtime resolves it. */
export function readerZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * A time zone as a client names it, its reader's `readerZone()`: a name
 * `DateTime.zoneMakeNamed` accepts, such as `America/Los_Angeles`, and
 * nothing else, so the service counts days and spells times only in a zone
 * that stands.
 */
export const timeZoneSchema = Schema.String.check(
  Schema.isMaxLength(MAX_ZONE_CHARS),
  Schema.makeFilter(
    (zone) => Option.isSome(DateTime.zoneMakeNamed(zone)),
    wireRefusal(SCHEMA_REFUSAL.MALFORMED),
  ),
);
