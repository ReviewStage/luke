import assert from "node:assert/strict";
import test from "node:test";
import { calendarWeeks, monthLabels, thinMonthLabels } from "../src/activity-calendar";

function series(firstDay: string, days: number): { day: string }[] {
  const start = Date.parse(`${firstDay}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, offset) => ({
    day: new Date(start + offset * 86_400_000).toISOString().slice(0, 10),
  }));
}

test("an empty account folds to no weeks at all", () => {
  assert.deepEqual(calendarWeeks([]), []);
});

test("a full Sunday-to-Saturday week fills its seven slots in order", () => {
  // 2026-08-16 is a Sunday.
  const weeks = calendarWeeks(series("2026-08-16", 7));
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0]?.weekStart, "2026-08-16");
  assert.deepEqual(
    weeks[0]?.days.map((day) => day?.day),
    [
      "2026-08-16",
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
    ],
  );
});

test("a span opening mid-week leaves the days before it empty", () => {
  // 2026-08-19 is a Wednesday; nine days end the following Thursday.
  const weeks = calendarWeeks(series("2026-08-19", 9));
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0]?.weekStart, "2026-08-16");
  assert.deepEqual(
    weeks[0]?.days.map((day) => day?.day),
    [undefined, undefined, undefined, "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22"],
  );
  assert.equal(weeks[1]?.weekStart, "2026-08-23");
  assert.deepEqual(
    weeks[1]?.days.map((day) => day?.day),
    ["2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", undefined, undefined],
  );
});

test("a span ending on a partial today leaves the days after it empty", () => {
  // Five days from Monday 2026-08-17 end on Friday the 21st, today's own day.
  const weeks = calendarWeeks(series("2026-08-17", 5));
  assert.equal(weeks.length, 1);
  assert.deepEqual(
    weeks[0]?.days.map((day) => day?.day),
    [undefined, "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", undefined],
  );
});

test("a 90-day span folds to thirteen Sunday-keyed weeks with a ragged end", () => {
  // 2026-05-24 is a Sunday, so 90 days ending Friday 2026-08-21 span twelve
  // full weeks and a six-day last week.
  const weeks = calendarWeeks(series("2026-05-24", 90));
  assert.equal(weeks.length, 13);
  assert.equal(weeks[0]?.weekStart, "2026-05-24");
  assert.equal(weeks[0]?.days[0]?.day, "2026-05-24");
  assert.equal(weeks.at(-1)?.weekStart, "2026-08-16");
  assert.equal(weeks.at(-1)?.days[5]?.day, "2026-08-21");
  assert.equal(weeks.at(-1)?.days[6], undefined);
  const coveredDays = weeks.flatMap((week) => week.days.filter((day) => day !== undefined));
  assert.equal(coveredDays.length, 90);
});

test("a trailing year folds to 53 columns: 52 complete weeks and today's partial one", () => {
  // 2025-08-17 is a Sunday; 366 days end on Monday 2026-08-17.
  const weeks = calendarWeeks(series("2025-08-17", 366));
  assert.equal(weeks.length, 53);
  assert.equal(weeks[0]?.weekStart, "2025-08-17");
  assert.equal(weeks.at(-1)?.weekStart, "2026-08-16");
  assert.equal(weeks.at(-1)?.days[1]?.day, "2026-08-17");
  assert.equal(weeks.at(-1)?.days[2], undefined);
  const coveredDays = weeks.flatMap((week) => week.days.filter((day) => day !== undefined));
  assert.equal(coveredDays.length, 366);
});

test("month labels mark the first column and each column opening a new month", () => {
  // 2026-07-27 is a Monday; a week and a half later August has begun.
  const labels = monthLabels(calendarWeeks(series("2026-07-27", 14)));
  assert.deepEqual(labels, ["Jul", "Aug", undefined]);
});

test("a first column starting mid-week is labeled for the days it shows", () => {
  // 2026-08-01 is a Saturday inside July's last calendar week.
  const labels = monthLabels(calendarWeeks(series("2026-08-01", 9)));
  assert.deepEqual(labels, ["Aug", undefined, undefined]);
});

test("thinning keeps every second label in place, first kept", () => {
  const labels = thinMonthLabels(
    ["Jul", undefined, "Aug", undefined, "Sep", "Oct", undefined, "Nov"],
    2,
  );
  assert.deepEqual(labels, [
    "Jul",
    undefined,
    undefined,
    undefined,
    "Sep",
    undefined,
    undefined,
    "Nov",
  ]);
});

test("a trailing year thins from thirteen labels to seven, both ends kept", () => {
  const labels = thinMonthLabels(monthLabels(calendarWeeks(series("2025-08-17", 366))), 2);
  const kept = labels.filter((label) => label !== undefined);
  assert.equal(kept.length, 7);
  assert.equal(labels[0], "Aug");
  assert.equal(kept.at(-1), "Aug");
});
