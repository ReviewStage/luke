import assert from "node:assert/strict";
import test from "node:test";
import { calendarWeeks, monthLabels } from "../src/activity-calendar";

function series(firstDay: string, days: number): { day: string }[] {
  const start = Date.parse(`${firstDay}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, offset) => ({
    day: new Date(start + offset * 86_400_000).toISOString().slice(0, 10),
  }));
}

test("an empty account folds to no weeks at all", () => {
  assert.deepEqual(calendarWeeks([]), []);
});

test("a full Monday-to-Sunday week fills its seven slots in order", () => {
  // 2026-08-17 is a Monday.
  const weeks = calendarWeeks(series("2026-08-17", 7));
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0]?.weekStart, "2026-08-17");
  assert.deepEqual(
    weeks[0]?.days.map((day) => day?.day),
    [
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
      "2026-08-23",
    ],
  );
});

test("a window opening mid-week leaves the days before it empty", () => {
  // 2026-08-19 is a Wednesday; nine days end the following Thursday.
  const weeks = calendarWeeks(series("2026-08-19", 9));
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0]?.weekStart, "2026-08-17");
  assert.deepEqual(
    weeks[0]?.days.map((day) => day?.day),
    [undefined, undefined, "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"],
  );
  assert.equal(weeks[1]?.weekStart, "2026-08-24");
  assert.deepEqual(
    weeks[1]?.days.map((day) => day?.day),
    ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", undefined, undefined, undefined],
  );
});

test("a window ending on a partial today leaves the days after it empty", () => {
  // Five days from Monday 2026-08-17 end on Friday the 21st, today's own day.
  const weeks = calendarWeeks(series("2026-08-17", 5));
  assert.equal(weeks.length, 1);
  assert.deepEqual(
    weeks[0]?.days.map((day) => day?.day),
    ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", undefined, undefined],
  );
});

test("a 90-day window folds to fourteen Monday-keyed weeks with ragged ends", () => {
  // 2026-05-24 is a Sunday, so 90 days ending Friday 2026-08-21 span a
  // one-day first week, twelve full weeks, and a five-day last week.
  const weeks = calendarWeeks(series("2026-05-24", 90));
  assert.equal(weeks.length, 14);
  assert.equal(weeks[0]?.weekStart, "2026-05-18");
  assert.deepEqual(
    weeks[0]?.days.map((day) => day?.day),
    [undefined, undefined, undefined, undefined, undefined, undefined, "2026-05-24"],
  );
  assert.equal(weeks.at(-1)?.weekStart, "2026-08-17");
  assert.equal(weeks.at(-1)?.days[4]?.day, "2026-08-21");
  assert.equal(weeks.at(-1)?.days[5], undefined);
  const coveredDays = weeks.flatMap((week) => week.days.filter((day) => day !== undefined));
  assert.equal(coveredDays.length, 90);
});

test("month labels mark the first column and each column opening a new month", () => {
  // 2026-07-27 is a Monday; two weeks later August has begun.
  const labels = monthLabels(calendarWeeks(series("2026-07-27", 14)));
  assert.deepEqual(labels, ["Jul", "Aug"]);
});

test("a first column starting mid-week is labeled for the days it shows", () => {
  // 2026-08-01 is a Saturday inside July's last calendar week.
  const labels = monthLabels(calendarWeeks(series("2026-08-01", 9)));
  assert.deepEqual(labels, ["Aug", undefined]);
});
