import assert from "node:assert/strict";
import { test } from "vitest";
import { oneShotDueAt } from "./wakeups.js";

/**
 * When a one-shot task Claude Code scheduled comes due, read in local time
 * from the five-field schedule that pins its minute and hour; a schedule
 * that pins no single minute, or names a weekday, tells no time here.
 */

const NOW = new Date(2026, 9, 21, 12, 0);

test("a one-shot pinned to a day and a month comes due then, or a year on once that minute has passed", () => {
  assert.deepEqual(oneShotDueAt("17 12 21 10 *", NOW), new Date(2026, 9, 21, 12, 17));
  assert.deepEqual(oneShotDueAt("17 9 21 10 *", NOW), new Date(2027, 9, 21, 9, 17));
  assert.deepEqual(oneShotDueAt("3 9 1 1 *", NOW), new Date(2027, 0, 1, 9, 3));
});

test("a one-shot pinned to a minute and an hour alone comes due at the next one", () => {
  assert.deepEqual(oneShotDueAt("30 14 * * *", NOW), new Date(2026, 9, 21, 14, 30));
  assert.deepEqual(oneShotDueAt("30 11 * * *", NOW), new Date(2026, 9, 22, 11, 30));
});

test("a schedule that pins no single minute, names a weekday, or matches no day tells no time", () => {
  for (const schedule of [
    "*/5 * * * *",
    "0,30 9 * * *",
    "0 9 * * 1-5",
    "0 9 21 10 3",
    "0 9 30 2 *",
    "0 24 * * *",
    "17 12 21 10",
  ]) {
    assert.equal(oneShotDueAt(schedule, NOW), undefined, schedule);
  }
});
