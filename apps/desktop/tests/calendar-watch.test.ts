import assert from "node:assert/strict";
import test from "node:test";
import type { CalendarFetch } from "../src/calendar-subscription";
import { CalendarWatch, type MeetingReading } from "../src/calendar-watch";
import { CALENDAR_ACCESS } from "../src/shared/contracts";

const NOON = Date.parse("2026-08-17T12:00:00Z");

function meeting(start: number): CalendarFetch {
  return {
    events: [
      {
        start,
        end: start + 30 * 60_000,
        allDay: false,
        participation: "accepted",
        others: 1,
        canceled: false,
      },
    ],
  };
}

test("nothing subscribed is nothing read, and nothing known", async () => {
  const readings: MeetingReading[] = [];
  let reads = 0;
  const watch = new CalendarWatch({
    onChanged: (reading) => readings.push(reading),
    read: async () => {
      reads += 1;
      return meeting(NOON);
    },
  });

  watch.setCalendars([]);

  // Not "no meeting": nobody looked. The gate holds nothing either way, and
  // the difference is what the Connections page says.
  assert.deepEqual(readings, [{ access: CALENDAR_ACCESS.UNKNOWN, events: [] }]);
  assert.equal(reads, 0);
});

test("what the subscribed calendars say is read together", async () => {
  const readings: MeetingReading[] = [];
  const watch = new CalendarWatch({
    onChanged: (reading) => readings.push(reading),
    read: async (url) => (url.includes("work") ? meeting(NOON) : meeting(NOON + 3_600_000)),
  });

  watch.setCalendars([
    { id: "work", url: "https://example.com/work.ics" },
    { id: "home", url: "https://example.com/home.ics" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  watch.stop();

  assert.equal(readings.at(-1)?.access, CALENDAR_ACCESS.GRANTED);
  assert.equal(readings.at(-1)?.events.length, 2);
});

test("one calendar failing is not every calendar failing", async () => {
  const readings: MeetingReading[] = [];
  const watch = new CalendarWatch({
    onChanged: (reading) => readings.push(reading),
    read: async (url) => (url.includes("work") ? meeting(NOON) : undefined),
  });

  watch.setCalendars([
    { id: "work", url: "https://example.com/work.ics" },
    { id: "gone", url: "https://example.com/gone.ics" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  watch.stop();

  // The one that answered is still worth reading, so the answer stands.
  assert.equal(readings.at(-1)?.access, CALENDAR_ACCESS.GRANTED);
  assert.equal(readings.at(-1)?.events.length, 1);
});

test("every calendar failing is a calendar Luke cannot see", async () => {
  const readings: MeetingReading[] = [];
  const watch = new CalendarWatch({
    onChanged: (reading) => readings.push(reading),
    read: async () => undefined,
  });

  watch.setCalendars([{ id: "gone", url: "https://example.com/gone.ics" }]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  watch.stop();

  // Unreadable rather than empty: only one of those two is a reason to speak
  // over a meeting, and it is neither.
  assert.deepEqual(readings.at(-1), { access: CALENDAR_ACCESS.UNAVAILABLE, events: [] });
});

test("a calendar's own name is offered back, so nobody has to invent one", async () => {
  const labels: string[] = [];
  const watch = new CalendarWatch({
    onChanged: () => undefined,
    onLabel: (id, label) => labels.push(`${id}:${label}`),
    read: async () => ({ ...meeting(NOON), label: "Work" }),
  });

  watch.setCalendars([{ id: "one", url: "https://example.com/work.ics" }]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  watch.stop();

  assert.deepEqual(labels, ["one:Work"]);
});
