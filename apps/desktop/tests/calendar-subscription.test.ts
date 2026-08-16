import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarEventsFromIcs,
  readCalendar,
  subscriptionHost,
} from "../src/calendar-subscription";
import { MEETING_PARTICIPATION } from "../src/meeting-events";

const NOON = Date.parse("2026-08-17T12:00:00Z");
const SELF = "dev@example.com";

/** One calendar file, written the way a published calendar actually arrives. */
function ics(...events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Example//EN",
    "X-WR-CALNAME:Work",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}

function event(lines: string[]): string {
  return ["BEGIN:VEVENT", "UID:1@example.com", ...lines, "END:VEVENT"].join("\r\n");
}

test("a calendar gives up its times, its name, and nothing else", () => {
  const read = calendarEventsFromIcs(
    ics(
      event([
        "SUMMARY:Layoff planning",
        "LOCATION:Room 3",
        "DESCRIPTION:Do not read this",
        "DTSTART:20260817T115500Z",
        "DTEND:20260817T122500Z",
        "ORGANIZER:mailto:lead@example.com",
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:dev@example.com",
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:lead@example.com",
      ]),
    ),
    NOON,
    SELF,
  );

  assert.equal(read?.label, "Work");
  assert.deepEqual(read?.events, [
    {
      start: Date.parse("2026-08-17T11:55:00Z"),
      end: Date.parse("2026-08-17T12:25:00Z"),
      allDay: false,
      participation: MEETING_PARTICIPATION.ACCEPTED,
      // The developer subtracted, so what is left is who they would be talking
      // over.
      others: 1,
      canceled: false,
    },
  ]);
  // The summary, the location and the description are all in the file above and
  // none of them survive the read: this is the whole of what is kept.
  assert.deepEqual(Object.keys(read?.events[0] ?? {}).sort(), [
    "allDay",
    "canceled",
    "end",
    "others",
    "participation",
    "start",
  ]);
});

test("a daily standup is read from its rule, not just its first day", () => {
  // The case a hand-rolled parser gets wrong and a calendar is mostly made of:
  // one event in the file, recurring, whose occurrence today is what matters.
  const read = calendarEventsFromIcs(
    ics(
      event([
        "SUMMARY:Standup",
        "DTSTART:20260810T115500Z",
        "DTEND:20260810T121000Z",
        "RRULE:FREQ=DAILY",
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:dev@example.com",
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:lead@example.com",
      ]),
    ),
    NOON,
    SELF,
  );

  const today = read?.events.find(
    (occurrence) => occurrence.start === Date.parse("2026-08-17T11:55:00Z"),
  );
  assert.ok(today, "the occurrence happening now is among them");
  assert.equal(today.others, 1);
});

test("the developer's own answer is read from their own attendee row", () => {
  const answer = (partstat: string) =>
    calendarEventsFromIcs(
      ics(
        event([
          "DTSTART:20260817T115500Z",
          "DTEND:20260817T122500Z",
          `ATTENDEE;PARTSTAT=${partstat}:mailto:dev@example.com`,
          "ATTENDEE;PARTSTAT=ACCEPTED:mailto:lead@example.com",
        ]),
      ),
      NOON,
      SELF,
    )?.events[0]?.participation;

  assert.equal(answer("ACCEPTED"), MEETING_PARTICIPATION.ACCEPTED);
  assert.equal(answer("DECLINED"), MEETING_PARTICIPATION.DECLINED);
  assert.equal(answer("NEEDS-ACTION"), MEETING_PARTICIPATION.PENDING);
  assert.equal(answer("DELEGATED"), MEETING_PARTICIPATION.EXCUSED);
});

test("a room is not somebody to talk over", () => {
  const read = calendarEventsFromIcs(
    ics(
      event([
        "DTSTART:20260817T115500Z",
        "DTEND:20260817T122500Z",
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:dev@example.com",
        "ATTENDEE;CUTYPE=ROOM:mailto:room3@example.com",
      ]),
    ),
    NOON,
    SELF,
  );

  // An hour of focus time with a room booked is a block, and blocks do not hold
  // notices back.
  assert.equal(read?.events[0]?.others, 0);
});

test("time the calendar says is free is not a meeting at all", () => {
  const read = calendarEventsFromIcs(
    ics(
      event([
        "SUMMARY:Somebody's birthday",
        "DTSTART;VALUE=DATE:20260817",
        "DTEND;VALUE=DATE:20260818",
        "TRANSP:TRANSPARENT",
        "ATTENDEE:mailto:lead@example.com",
      ]),
    ),
    NOON,
    SELF,
  );

  // Marked transparent by the calendar itself: it occupies no time, whatever
  // else it says, so it never reaches the rules downstream.
  assert.deepEqual(read?.events, []);
});

test("an event outside the window is not carried, and neither is a whole day", () => {
  const read = calendarEventsFromIcs(
    ics(
      event(["UID:2@example.com", "DTSTART:20260819T090000Z", "DTEND:20260819T100000Z"]),
      event(["UID:3@example.com", "DTSTART;VALUE=DATE:20260817", "DTEND;VALUE=DATE:20260818"]),
    ),
    NOON,
    SELF,
  );

  // Two days out is beyond the window; the all-day one is inside it and is
  // carried, marked as what it is, because deciding is the gate's job.
  assert.equal(read?.events.length, 1);
  assert.equal(read?.events[0]?.allDay, true);
});

test("something that is not a calendar is nothing rather than a guess", () => {
  assert.equal(calendarEventsFromIcs("<html>sorry</html>", NOON, SELF), undefined);
  assert.equal(calendarEventsFromIcs("", NOON, SELF), undefined);
});

test("only an https address is a calendar address", () => {
  assert.equal(
    subscriptionHost("https://calendar.google.com/calendar/ical/x/basic.ics"),
    "calendar.google.com",
  );
  // The address carries the right to read the calendar, so there is no version
  // of it worth sending in the clear — and a webcal link is one paste away from
  // being an https one.
  assert.equal(subscriptionHost("http://calendar.example.com/basic.ics"), undefined);
  assert.equal(subscriptionHost("webcal://calendar.example.com/basic.ics"), undefined);
  assert.equal(subscriptionHost("not a url"), undefined);
});

test("a calendar that answers with anything but a calendar is unreadable", async () => {
  const said: string[] = [];
  const answer = await readCalendar("https://calendar.example.com/basic.ics", SELF, {
    fetch: async () => new Response("<html>sign in</html>", { status: 200 }),
    now: () => NOON,
    onDiagnostic: (message) => said.push(message),
  });

  // Not an empty calendar: a login page where a calendar should be is a
  // subscription that is not working, and the gate must be able to tell.
  assert.equal(answer, undefined);
  assert.match(said[0] ?? "", /not a calendar/);
});

test("a calendar that refuses is unreadable, and says which one", async () => {
  const said: string[] = [];
  const answer = await readCalendar("https://calendar.example.com/basic.ics", SELF, {
    fetch: async () => new Response("nope", { status: 404 }),
    now: () => NOON,
    onDiagnostic: (message) => said.push(message),
  });

  assert.equal(answer, undefined);
  assert.match(said[0] ?? "", /calendar\.example\.com answered 404/);
});
