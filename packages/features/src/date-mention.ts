import { DAY_MS } from "@repo/runtime/vocabulary";
import { SCHEMA_REFUSAL } from "@repo/wire";
import { wireRefusal } from "@repo/wire/effect";
import { DateTime, Option, Schema } from "effect";
import { distanceText } from "./time-format.js";

const LOCALE = "en-US";

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

const TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})([+-])(\d{2}):(\d{2})$/u;

const MAX_OFFSET_HOURS = 14;

const MAX_ZONE_CHARS = 64;

const NAMED_DAYS = [
  { word: "today", shift: 0, least: 3 },
  { word: "tomorrow", shift: 1, least: 4 },
  { word: "yesterday", shift: -1, least: 3 },
] as const;

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

const LEAST_NAME = 3;

const MAX_WORDS_CHARS = 80;

const RANGE_JOIN = / (?:to|until|-|–|→) | ?→ ?/u;

const TRAILING_TIME =
  /(?:^| )(?:at )?(?:(\d{1,2})(?::(\d{2}))? ?(am|pm|a|p)|(\d{1,2}):(\d{2})|(noon|midnight))$/u;

const RANGE_ARROW = " → ";

export interface DateSpan {
  readonly start: string;
  readonly end?: string;
}

interface Day {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface Clock {
  readonly hour: number;
  readonly minute: number;
}

interface Moment {
  readonly day: Day;
  readonly clock: Clock | undefined;
}

function isoDay(day: Day): string {
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  return `${pad(day.year, 4)}-${pad(day.month, 2)}-${pad(day.day, 2)}`;
}

function realDay(year: number, month: number, day: number): Day | undefined {
  if (year < 1000 || year > 9999) return undefined;
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day
    ? { year, month, day }
    : undefined;
}

function utcOf(day: Day): number {
  return Date.UTC(day.year, day.month - 1, day.day);
}

function dayOfUtc(at: number): Day {
  const date = new Date(at);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function shifted(day: Day, count: number): Day {
  return dayOfUtc(utcOf(day) + count * DAY_MS);
}

function monthsOn(day: Day, count: number): Day {
  const first = new Date(Date.UTC(day.year, day.month - 1 + count, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return dayOfUtc(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day.day, last)));
}

function weekdayOf(day: Day): number {
  return new Date(utcOf(day)).getUTCDay();
}

function daysBetween(from: Day, day: Day): number {
  return Math.round((utcOf(day) - utcOf(from)) / DAY_MS);
}

function dayOfIso(iso: string): Day | undefined {
  const match = DAY_PATTERN.exec(iso);
  if (match === null) return undefined;
  return realDay(Number(match[1]), Number(match[2]), Number(match[3]));
}

function todayIn(now: number, zone: string): Day | undefined {
  const zoned = DateTime.makeZoned(now, { timeZone: zone });
  return Option.isNone(zoned) ? undefined : dayOfIso(DateTime.formatIsoDate(zoned.value));
}

function nameIndex(names: readonly string[], word: string): number {
  if (word.length < LEAST_NAME) return -1;
  return names.findIndex((name) => name.startsWith(word));
}

function nearestDay(today: Day, month: number, day: number): Day | undefined {
  const near = [today.year - 1, today.year, today.year + 1]
    .map((year) => realDay(year, month, day))
    .filter((each): each is Day => each !== undefined)
    .sort((a, b) => Math.abs(daysBetween(today, a)) - Math.abs(daysBetween(today, b)));
  return near[0];
}

function yearOf(written: string): number {
  return written.length === 2 ? 2000 + Number(written) : Number(written);
}

function weekdayDay(today: Day, which: string | undefined, weekday: number): Day {
  const now = weekdayOf(today);
  if (which === "last") return shifted(today, -((now - weekday + 7) % 7 || 7));
  if (which === "next") {
    const monday = shifted(today, -((now + 6) % 7));
    return shifted(monday, 7 + ((weekday + 6) % 7));
  }
  return shifted(today, (weekday - now + 7) % 7 || 7);
}

function namedDay(words: string, today: Day): Day | undefined {
  if (TOMORROW_SHORT.has(words)) return shifted(today, 1);
  const named = NAMED_DAYS.find(
    (each) => words.length >= each.least && each.word.startsWith(words),
  );
  return named === undefined ? undefined : shifted(today, named.shift);
}

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

function numericDay(words: string, today: Day): Day | undefined {
  const iso = dayOfIso(words);
  if (iso !== undefined) return iso;
  const us = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/u.exec(words);
  if (us === null) return undefined;
  const month = Number(us[1]);
  const day = Number(us[2]);
  return us[3] === undefined ? nearestDay(today, month, day) : realDay(yearOf(us[3]), month, day);
}

function dayOfWords(words: string, today: Day): Day | undefined {
  return (
    namedDay(words, today) ??
    weekDay(words, today) ??
    countedDay(words, today) ??
    monthDay(words, today) ??
    numericDay(words, today)
  );
}

function clockOf(hour: number, minute: number, half: string | undefined): Clock | undefined {
  if (minute > 59) return undefined;
  if (half === undefined) return hour > 23 ? undefined : { hour, minute };
  if (hour < 1 || hour > 12) return undefined;
  const pm = half.startsWith("p");
  return { hour: (hour % 12) + (pm ? 12 : 0), minute };
}

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

function dayAfter(words: string, start: Day): Day | undefined {
  const bare = /^(\d{1,2})(?:st|nd|rd|th)?$/u.exec(words);
  if (bare === null) return undefined;
  const day = Number(bare[1]);
  const same = realDay(start.year, start.month, day);
  if (same !== undefined && daysBetween(start, same) > 0) return same;
  const next = monthsOn({ ...start, day: 1 }, 1);
  return realDay(next.year, next.month, day);
}

function momentOf(words: string, today: Day, alone: Day): Moment | undefined {
  const timed = splitTime(words);
  if (timed === undefined) {
    const day = dayOfWords(words, today);
    return day === undefined ? undefined : { day, clock: undefined };
  }
  const day = timed.rest === "" ? alone : dayOfWords(timed.rest, today);
  return day === undefined ? undefined : { day, clock: timed.clock };
}

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

function instantOf(moment: string): number {
  const time = TIME_PATTERN.exec(moment);
  if (time === null) return utcOf(dayOfIso(moment) ?? { year: 0, month: 1, day: 1 });
  return Date.parse(moment);
}

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

function isTimed(moment: string): boolean {
  return TIME_PATTERN.test(moment);
}

export function isDateRange(start: string, end: string): boolean {
  return (
    isDateMoment(start) &&
    isDateMoment(end) &&
    isTimed(start) === isTimed(end) &&
    instantOf(end) > instantOf(start)
  );
}

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

export function suggestedDates(now: number, zone: string): readonly DateSpan[] {
  const today = todayIn(now, zone);
  if (today === undefined) return [];
  return [today, shifted(today, 1), weekdayDay(today, undefined, 1)].map((day) => ({
    start: isoDay(day),
  }));
}

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

function offsetZone(moment: string): string {
  const time = TIME_PATTERN.exec(moment);
  if (time === null) return "UTC";
  return `${time[6]}${time[7]}:${time[8]}`;
}

function dayWords(day: Day, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: "UTC" }).format(utcOf(day));
}

function timeWords(moment: string, zone: string, named: boolean): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  };
  if (named) options.timeZoneName = "short";
  return new Intl.DateTimeFormat(LOCALE, options).format(Date.parse(moment));
}

function sameDay(start: string, end: string, zone: string): boolean {
  const a = wallOf(start, zone);
  const b = wallOf(end, zone);
  return a !== undefined && b !== undefined && daysBetween(a.day, b.day) === 0;
}

function momentLabel(moment: string, zone: string): string {
  const wall = wallOf(moment, zone);
  if (wall === undefined) return moment;
  const day = dayWords(wall.day, { month: "short", day: "numeric", year: "numeric" });
  return wall.clock === undefined ? day : `${day}, ${timeWords(moment, zone, true)}`;
}

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

function relativeMoment(moment: string, today: Day, zone: string): string {
  const wall = wallOf(moment, zone);
  if (wall === undefined) return moment;
  const day = relativeDay(wall.day, today);
  return wall.clock === undefined ? day : `${day} ${timeWords(moment, zone, false)}`;
}

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

export function dateWhole(span: DateSpan, zone: string): string {
  const start = momentWhole(span.start, zone);
  return span.end === undefined ? start : `${start}${RANGE_ARROW}${momentWhole(span.end, zone)}`;
}

export function dateDistance(span: DateSpan, now: number, zone: string): string {
  const today = todayIn(now, zone);
  const wall = wallOf(span.start, zone);
  if (today === undefined || wall === undefined) return "";
  const days = daysBetween(today, wall.day);
  if (isTimed(span.start)) {
    const ahead = Date.parse(span.start) - now;
    if (Math.abs(ahead) < DAY_MS) return distanceText(ahead);
  }
  const named = NAMED_DAYS.find((each) => each.shift === days);
  return named === undefined ? distanceText(days * DAY_MS) : named.word;
}

export interface DateWallMoment {
  readonly day: string;
  readonly time?: string | undefined;
}

export interface DateWall {
  readonly start: DateWallMoment;
  readonly end?: DateWallMoment | undefined;
}

const WALL_TIME = /^(\d{2}):(\d{2})$/u;

function wallMoment(moment: string, zone: string): DateWallMoment | undefined {
  const wall = wallOf(moment, zone);
  if (wall === undefined) return undefined;
  const day = isoDay(wall.day);
  if (wall.clock === undefined) return { day };
  const pad = (value: number) => String(value).padStart(2, "0");
  return { day, time: `${pad(wall.clock.hour)}:${pad(wall.clock.minute)}` };
}

export function dateWall(span: DateSpan, zone: string): DateWall | undefined {
  const start = wallMoment(span.start, zone);
  if (start === undefined) return undefined;
  const end = span.end === undefined ? undefined : wallMoment(span.end, zone);
  return end === undefined ? { start } : { start, end };
}

function spelledWall(moment: DateWallMoment, zone: string): string | undefined {
  const day = dayOfIso(moment.day);
  if (day === undefined) return undefined;
  if (moment.time === undefined) return spelled({ day, clock: undefined }, zone);
  const time = WALL_TIME.exec(moment.time);
  const clock = time === null ? undefined : clockOf(Number(time[1]), Number(time[2]), undefined);
  return clock === undefined ? undefined : spelled({ day, clock }, zone);
}

export function dateOfWall(wall: DateWall, zone: string): DateSpan | undefined {
  const start = spelledWall(wall.start, zone);
  if (start === undefined) return undefined;
  const end = wall.end === undefined ? undefined : spelledWall(wall.end, zone);
  if (end === undefined) return { start };
  if (isDateRange(start, end)) return { start, end };
  return isDateRange(end, start) ? { start: end, end: start } : { start };
}

export function dateToday(now: number, zone: string): string | undefined {
  const today = todayIn(now, zone);
  return today === undefined ? undefined : isoDay(today);
}

export function readerZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export const timeZoneSchema = Schema.String.check(
  Schema.isMaxLength(MAX_ZONE_CHARS),
  Schema.makeFilter(
    (zone) => Option.isSome(DateTime.zoneMakeNamed(zone)),
    wireRefusal(SCHEMA_REFUSAL.MALFORMED),
  ),
);
