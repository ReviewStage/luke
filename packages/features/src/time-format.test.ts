import assert from "node:assert/strict";
import { test } from "vitest";
import {
  agoText,
  callHeading,
  clockText,
  distanceText,
  formatDayHeading,
  formatDayTick,
  formatInstant,
  playheadText,
  sinceText,
  weekdayAndTimeText,
  workingTime,
} from "./time-format.js";

test("a call's header names its day as today, yesterday, a weekday this week, or a date", () => {
  const now = new Date(2026, 9, 8, 18, 0).getTime();
  const at = (month: number, day: number, year = 2026) =>
    new Date(year, month, day, 15, 42).getTime();

  assert.equal(callHeading(at(9, 8), now), "Today, 3:42 PM");
  assert.equal(callHeading(at(9, 7), now), "Yesterday, 3:42 PM");
  assert.equal(callHeading(at(9, 5), now), "Monday, 3:42 PM");
  assert.equal(callHeading(at(8, 21), now), "Sep 21, 3:42 PM");
  assert.equal(callHeading(at(11, 30, 2025), now), "Dec 30, 2025, 3:42 PM");
});

test("a run's length counts in seconds, then minutes, then hours", () => {
  assert.equal(workingTime(42_000), "42s");
  assert.equal(workingTime(72_000), "1m 12s");
  assert.equal(workingTime(3_780_000), "1h 3m");
  assert.equal(workingTime(-5), "0s");
});

test("a calendar day is named in UTC whatever the zone the reader is in", () => {
  assert.equal(formatDayTick("2026-08-21"), "Aug 21");
  assert.equal(formatDayHeading("2026-08-21"), "August 21, 2026");
  assert.equal(formatInstant(Date.UTC(2026, 9, 21, 12, 4)), "Oct 21, 12:04 PM UTC");
});

test("a row and a line say an age with the same count, the line adding ago", () => {
  const now = new Date(2026, 9, 23, 12, 0).getTime();
  const hoursAgo = (hours: number) => now - hours * 3_600_000;

  assert.equal(sinceText(hoursAgo(3), now), "3h");
  assert.equal(agoText(hoursAgo(3), now), "3h ago");
  assert.equal(sinceText(now - 20_000, now), "now");
  assert.equal(agoText(now - 20_000, now), "now");
});

test("a distance from now counts ahead with in and behind with ago, in days past a day", () => {
  assert.equal(distanceText(30 * 60_000), "in 30m");
  assert.equal(distanceText(-3 * 3_600_000), "3h ago");
  assert.equal(distanceText(10 * 86_400_000), "in 10d");
  assert.equal(distanceText(-3 * 86_400_000), "3d ago");
  assert.equal(distanceText(-59_000), "now");
});

test("every clock is a 12-hour one, a schedule's included", () => {
  assert.equal(clockText(14, 5), "2:05 PM");
  assert.equal(clockText(0, 0), "12:00 AM");
  assert.equal(clockText(12, 30), "12:30 PM");
  assert.equal(clockText(9, 5), "9:05 AM");
  assert.equal(weekdayAndTimeText(new Date(2026, 9, 19, 14, 5).getTime()), "Mon 2:05 PM");
});

test("a playhead reads minutes and two-digit seconds, past an hour in minutes", () => {
  assert.equal(playheadText(72_000), "1:12");
  assert.equal(playheadText(5_400), "0:05");
  assert.equal(playheadText(3_725_000), "62:05");
  assert.equal(playheadText(-1), "0:00");
});
