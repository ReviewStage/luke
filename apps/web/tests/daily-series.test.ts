import assert from "node:assert/strict";
import test from "node:test";
import { partialDayKey, seriesHasNoData } from "../src/daily-series";

test("a zero-filled series reads as no data", () => {
  assert.equal(seriesHasNoData([0, 0, 0]), true);
});

test("one active day means the series has data", () => {
  assert.equal(seriesHasNoData([0, 3, 0]), false);
});

test("a series with no days at all reads as no data", () => {
  assert.equal(seriesHasNoData([]), true);
});

test("the last day is partial when it is the day the response was generated", () => {
  const daily = [{ day: "2026-08-20" }, { day: "2026-08-21" }];
  assert.equal(partialDayKey(daily, Date.UTC(2026, 7, 21, 14, 30)), "2026-08-21");
});

test("a generation instant just inside a UTC day still marks that day", () => {
  const daily = [{ day: "2026-08-21" }];
  assert.equal(partialDayKey(daily, Date.UTC(2026, 7, 21, 0, 0, 1)), "2026-08-21");
});

test("a series ending before the generated day has no partial day", () => {
  const daily = [{ day: "2026-08-19" }, { day: "2026-08-20" }];
  assert.equal(partialDayKey(daily, Date.UTC(2026, 7, 21)), undefined);
});

test("an empty series has no partial day", () => {
  assert.equal(partialDayKey([], Date.UTC(2026, 7, 21)), undefined);
});
