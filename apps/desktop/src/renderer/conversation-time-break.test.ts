import assert from "node:assert/strict";
import { test } from "vitest";
import {
  CONVERSATION_TIME_BREAK_MS,
  createConversationTimeBreakFormatter,
  opensConversationTimeBreak,
} from "./conversation-time-break";

const NOW = Date.parse("2026-09-08T17:30:00.000Z");
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

test("the first recorded line opens a break, and a silence of an hour opens the next", () => {
  assert.equal(opensConversationTimeBreak(undefined, NOW), true);
  assert.equal(opensConversationTimeBreak(NOW, NOW + 59 * MINUTE_MS), false);
  assert.equal(opensConversationTimeBreak(NOW, NOW + CONVERSATION_TIME_BREAK_MS), true);
  assert.equal(opensConversationTimeBreak(NOW, NOW + DAY_MS), true);
});

test("a line with no stamp opens no break", () => {
  assert.equal(opensConversationTimeBreak(undefined, undefined), false);
  assert.equal(opensConversationTimeBreak(NOW, undefined), false);
});

const label = createConversationTimeBreakFormatter({
  locale: "en-US",
  timeZone: "America/Los_Angeles",
});

test("a line from today is named by its time alone under Today", () => {
  assert.deepEqual(label(NOW - 3 * 60 * MINUTE_MS, NOW), { day: "Today", time: "7:30 AM" });
});

test("the calendar day is read in the reader's zone, not UTC", () => {
  // 03:00 UTC on the 8th is still the evening of the 7th in Los Angeles.
  assert.deepEqual(label(Date.parse("2026-09-08T03:00:00.000Z"), NOW), {
    day: "Yesterday",
    time: "8:00 PM",
  });
});

test("the past week's days are named by weekday, and a week on by date", () => {
  assert.equal(label(NOW - 2 * DAY_MS, NOW).day, "Sunday");
  assert.equal(label(NOW - 6 * DAY_MS, NOW).day, "Wednesday");
  assert.equal(label(NOW - 7 * DAY_MS, NOW).day, "Tue, Sep 1");
  assert.equal(label(NOW - 14 * DAY_MS, NOW).day, "Tue, Aug 25");
});

test("a line from another year carries the year", () => {
  assert.deepEqual(label(Date.parse("2025-12-31T20:15:00.000Z"), NOW), {
    day: "Dec 31, 2025",
    time: "12:15 PM",
  });
});

test("a stamp ahead of the clock is dated rather than called Today", () => {
  assert.equal(label(NOW + 2 * DAY_MS, NOW).day, "Thu, Sep 10");
});
