import assert from "node:assert/strict";
import { test } from "vitest";
import {
  callHeading,
  formatDayHeading,
  formatDayTick,
  formatInstant,
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
  assert.equal(formatInstant(Date.UTC(2026, 9, 21, 12, 4)), "Oct 21, 12:04 UTC");
});
