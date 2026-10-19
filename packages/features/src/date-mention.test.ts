import assert from "node:assert/strict";
import { test } from "vitest";
import {
  dateChipText,
  dateDistance,
  dateLabel,
  dateOfWords,
  dateWhole,
  isDateMoment,
  isDateRange,
  suggestedDates,
} from "./date-mention.js";

/** Monday, October 19, 2026, at 10:00 in the morning in Los Angeles. */
const NOW = Date.parse("2026-10-19T10:00-07:00");
const LOS_ANGELES = "America/Los_Angeles";
const TOKYO = "Asia/Tokyo";

/** The start the words name, from NOW in Los Angeles. */
function startOf(words: string): string | undefined {
  return dateOfWords(words, NOW, LOS_ANGELES)?.start;
}

test("a named day, typed in full or far enough to tell, is that day from today", () => {
  assert.equal(startOf("today"), "2026-10-19");
  assert.equal(startOf("tod"), "2026-10-19");
  assert.equal(startOf("tomorrow"), "2026-10-20");
  assert.equal(startOf("tomo"), "2026-10-20");
  assert.equal(startOf("tmrw"), "2026-10-20");
  assert.equal(startOf("Yesterday"), "2026-10-18");
  // Note that `tom` is a name as often as it is tomorrow, so it is no date.
  assert.equal(startOf("tom"), undefined);
});

test("a weekday is the next one after today; next is the one in next week, last the one before today", () => {
  assert.equal(startOf("fri"), "2026-10-23");
  assert.equal(startOf("this friday"), "2026-10-23");
  assert.equal(startOf("mon"), "2026-10-26");
  assert.equal(startOf("next fri"), "2026-10-30");
  assert.equal(startOf("last fri"), "2026-10-16");
  assert.equal(startOf("last mon"), "2026-10-12");
  assert.equal(startOf("fr"), undefined);
});

test("next week, next month, and a count from today are counted from today", () => {
  assert.equal(startOf("next week"), "2026-10-26");
  assert.equal(startOf("next month"), "2026-11-01");
  assert.equal(startOf("in 3 days"), "2026-10-22");
  assert.equal(startOf("in 2w"), "2026-11-02");
  assert.equal(startOf("in 4 months"), "2027-02-19");
  assert.equal(startOf("10 days ago"), "2026-10-09");
});

test("a month and its day is the nearest such day, unless a year is written", () => {
  assert.equal(startOf("oct 30"), "2026-10-30");
  assert.equal(startOf("30 october"), "2026-10-30");
  assert.equal(startOf("jan 4"), "2027-01-04");
  assert.equal(startOf("aug 1"), "2026-08-01");
  assert.equal(startOf("jan 4, 2029"), "2029-01-04");
  assert.equal(startOf("2026-12-24"), "2026-12-24");
  assert.equal(startOf("12/31"), "2026-12-31");
  assert.equal(startOf("2/3/27"), "2027-02-03");
  assert.equal(startOf("feb 30"), undefined);
  assert.equal(startOf("2026-02-29"), undefined);
  // A month's name alone names no day, so a person called May is not taken for one.
  assert.equal(startOf("may"), undefined);
});

test("a time after a day, or alone for today, is spelled with the offset the reader's zone stands at then", () => {
  assert.equal(startOf("tomorrow 3pm"), "2026-10-20T15:00-07:00");
  assert.equal(startOf("fri at 9:30am"), "2026-10-23T09:30-07:00");
  assert.equal(startOf("3pm"), "2026-10-19T15:00-07:00");
  assert.equal(startOf("noon"), "2026-10-19T12:00-07:00");
  assert.equal(startOf("dec 1 15:00"), "2026-12-01T15:00-08:00");
  assert.equal(dateOfWords("tomorrow 3pm", NOW, TOKYO)?.start, "2026-10-21T15:00+09:00");
  assert.equal(startOf("13pm"), undefined);
});

test("a range joins two ends of one kind, the second perhaps a time alone on the first's day", () => {
  assert.deepEqual(dateOfWords("fri to mon", NOW, LOS_ANGELES), {
    start: "2026-10-23",
    end: "2026-10-26",
  });
  assert.deepEqual(dateOfWords("tomorrow 3pm - 5pm", NOW, LOS_ANGELES), {
    start: "2026-10-20T15:00-07:00",
    end: "2026-10-20T17:00-07:00",
  });
  assert.deepEqual(dateOfWords("today → fri", NOW, LOS_ANGELES), {
    start: "2026-10-19",
    end: "2026-10-23",
  });
  assert.deepEqual(dateOfWords("next fri at 3pm to 5pm", NOW, LOS_ANGELES), {
    start: "2026-10-30T15:00-07:00",
    end: "2026-10-30T17:00-07:00",
  });
  assert.equal(dateOfWords("fri 3pm to mon", NOW, LOS_ANGELES), undefined);
  assert.equal(dateOfWords("tomorrow to today", NOW, LOS_ANGELES), undefined);
});

test("a range's end written as a day of the month alone is that day after its start, in the next month where it must be", () => {
  assert.deepEqual(dateOfWords("oct 20 to 24", NOW, LOS_ANGELES), {
    start: "2026-10-20",
    end: "2026-10-24",
  });
  assert.deepEqual(dateOfWords("oct 28 - 3rd", NOW, LOS_ANGELES), {
    start: "2026-10-28",
    end: "2026-11-03",
  });
  assert.equal(dateOfWords("oct 28 to 28", NOW, LOS_ANGELES)?.end, "2026-11-28");
  assert.equal(dateOfWords("jan 30 to 30", NOW, LOS_ANGELES), undefined);
  assert.equal(dateOfWords("tomorrow 3pm to 24", NOW, LOS_ANGELES), undefined);
});

test("a range whose end read from today falls before its start is read from its start", () => {
  const saturday = Date.parse("2026-10-24T10:00-07:00");
  assert.deepEqual(dateOfWords("fri to mon", saturday, LOS_ANGELES), {
    start: "2026-10-30",
    end: "2026-11-02",
  });
});

test("words that are no date name none", () => {
  for (const words of ["", "next time we ship", "rollout", "fri to mon to tue", "3"]) {
    assert.equal(dateOfWords(words, NOW, LOS_ANGELES), undefined, words);
  }
});

test("a moment is a real day, or a real time with an offset; a range's ends are of one kind, in order", () => {
  assert.equal(isDateMoment("2026-10-20"), true);
  assert.equal(isDateMoment("2026-10-20T15:00-07:00"), true);
  assert.equal(isDateMoment("2026-10-20T15:00"), false);
  assert.equal(isDateMoment("2026-13-01"), false);
  assert.equal(isDateMoment("2026-10-20T24:00+00:00"), false);
  assert.equal(isDateRange("2026-10-20", "2026-10-24"), true);
  assert.equal(isDateRange("2026-10-24", "2026-10-20"), false);
  assert.equal(isDateRange("2026-10-20", "2026-10-20T15:00-07:00"), false);
});

test("a date is written in full, a time with its zone's name, and a range's end on its start's day by its time", () => {
  assert.equal(dateLabel({ start: "2026-10-20" }), "Oct 20, 2026");
  assert.equal(
    dateLabel({ start: "2026-10-20T15:00-07:00" }, LOS_ANGELES),
    "Oct 20, 2026, 3:00 PM PDT",
  );
  assert.equal(dateLabel({ start: "2026-10-20T15:00-07:00" }), "Oct 20, 2026, 3:00 PM GMT-7");
  assert.equal(
    dateLabel({ start: "2026-10-20", end: "2026-10-24" }),
    "Oct 20, 2026 → Oct 24, 2026",
  );
  assert.equal(
    dateLabel({ start: "2026-10-20T15:00-07:00", end: "2026-10-20T17:00-07:00" }, LOS_ANGELES),
    "Oct 20, 2026, 3:00 PM PDT → 5:00 PM PDT",
  );
});

test("a chip says a day from the reader's today: named, a weekday this week or last, else the date", () => {
  const said = (start: string) => dateChipText({ start }, NOW, LOS_ANGELES);
  assert.equal(said("2026-10-19"), "Today");
  assert.equal(said("2026-10-20"), "Tomorrow");
  assert.equal(said("2026-10-18"), "Yesterday");
  assert.equal(said("2026-10-23"), "Friday");
  assert.equal(said("2026-10-16"), "Last Friday");
  assert.equal(said("2026-11-28"), "Nov 28");
  assert.equal(said("2027-01-04"), "Jan 4, 2027");
});

test("a chip says a time in the reader's own zone, and a range's end on its start's day by its time", () => {
  const meeting = { start: "2026-10-20T15:00-07:00", end: "2026-10-20T17:00-07:00" };
  assert.equal(dateChipText(meeting, NOW, LOS_ANGELES), "Tomorrow 3:00 PM → 5:00 PM");
  // Note that it is already Tuesday in Tokyo, so Wednesday morning there is tomorrow.
  assert.equal(dateChipText(meeting, NOW, TOKYO), "Tomorrow 7:00 AM → 9:00 AM");
  assert.equal(
    dateChipText({ start: "2026-10-23", end: "2026-10-26" }, NOW, LOS_ANGELES),
    "Friday → Oct 26",
  );
});

test("a card says the date in full and how far it stands from now", () => {
  assert.equal(dateWhole({ start: "2026-10-20" }, LOS_ANGELES), "Tuesday, October 20, 2026");
  assert.equal(
    dateWhole({ start: "2026-10-20T15:00-07:00" }, LOS_ANGELES),
    "Tuesday, October 20, 2026 at 3:00 PM PDT",
  );
  assert.equal(dateDistance({ start: "2026-10-19" }, NOW, LOS_ANGELES), "today");
  assert.equal(dateDistance({ start: "2026-10-23" }, NOW, LOS_ANGELES), "in 4 days");
  assert.equal(dateDistance({ start: "2026-10-16" }, NOW, LOS_ANGELES), "3 days ago");
  assert.equal(
    dateDistance({ start: "2026-10-19T10:30-07:00" }, NOW, LOS_ANGELES),
    "in 30 minutes",
  );
  assert.equal(dateDistance({ start: "2026-10-19T07:00-07:00" }, NOW, LOS_ANGELES), "3 hours ago");
  assert.equal(dateDistance({ start: "2026-10-22T07:00-07:00" }, NOW, LOS_ANGELES), "in 3 days");
});

test("a list narrowed to dates offers today, tomorrow, and next Monday", () => {
  assert.deepEqual(suggestedDates(NOW, LOS_ANGELES), [
    { start: "2026-10-19" },
    { start: "2026-10-20" },
    { start: "2026-10-26" },
  ]);
});

test("words far longer than an @ word, spaces among them, name no date", () => {
  assert.equal(dateOfWords(`fri${" ".repeat(10_000)}3pm`, NOW, LOS_ANGELES), undefined);
  assert.equal(dateOfWords(`oct 20${" to".repeat(40)}`, NOW, LOS_ANGELES), undefined);
});
