import assert from "node:assert/strict";
import test from "node:test";
import { CALENDAR_LOOKAHEAD_MS, MAXIMUM_MEETING_LENGTH_MS } from "@sidecar/calendar";
import { APPLE_CALENDAR_ACCESS, APPLE_CALENDAR_ID } from "#shared/apple-calendar";
import {
  type AppleCalendarConnection,
  AppleCalendarReader,
  parseHelperReport,
} from "./apple-calendar";

const NOW = Date.parse("2026-08-19T12:00:00Z");

interface RecordedRun {
  helperArguments: readonly string[];
  timeoutMs: number;
}

/** The reader with a fake helper, so no Mac and no binary is ever needed. */
function readerFor(options: {
  connection?: AppleCalendarConnection;
  answer: (helperArguments: readonly string[]) => string | Error;
}) {
  const runs: RecordedRun[] = [];
  const reader = new AppleCalendarReader({
    readConnection: async () => options.connection,
    runHelper: async (helperArguments, timeoutMs) => {
      runs.push({ helperArguments, timeoutMs });
      const answer = options.answer(helperArguments);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    now: () => NOW,
  });
  return { reader, runs };
}

function fullAccessAnswer(): string {
  return JSON.stringify({
    access: APPLE_CALENDAR_ACCESS.FULL,
    calendars: [
      { id: "work", label: "Work", color: "#ff2d55" },
      { id: "home", label: "Home" },
    ],
    busy: [
      { start: "2026-08-19T13:00:00Z", end: "2026-08-19T13:30:00Z" },
      { start: "2026-08-19T11:45:00Z", end: "2026-08-19T12:15:00Z" },
    ],
  });
}

test("with no connection the helper is never run", async () => {
  const { reader, runs } = readerFor({ answer: () => fullAccessAnswer() });
  assert.equal(await reader.observe(), undefined);
  assert.equal(runs.length, 0);
});

test("a pass asks for the shared window and the chosen calendars, and answers meetings", async () => {
  const { reader, runs } = readerFor({
    connection: { selectedCalendarIds: ["work", "home"] },
    answer: () => fullAccessAnswer(),
  });

  const observation = await reader.observe();
  assert.deepEqual(runs[0]?.helperArguments, [
    "observe",
    new Date(NOW - MAXIMUM_MEETING_LENGTH_MS).toISOString(),
    new Date(NOW + CALENDAR_LOOKAHEAD_MS).toISOString(),
    "work",
    "home",
  ]);
  assert.equal(observation?.accountId, APPLE_CALENDAR_ID);
  assert.deepEqual(observation?.calendars, [
    { id: "home", label: "Home" },
    { id: "work", label: "Work", color: "#ff2d55" },
  ]);
  // Normalized through the same bounding the Google intervals pass: sorted,
  // and carried as instants.
  assert.deepEqual(observation?.meetings, [
    { startsAt: Date.parse("2026-08-19T11:45:00Z"), endsAt: Date.parse("2026-08-19T12:15:00Z") },
    { startsAt: Date.parse("2026-08-19T13:00:00Z"), endsAt: Date.parse("2026-08-19T13:30:00Z") },
  ]);
  assert.equal(observation?.failure, undefined);
});

test("calendars section by source and read in Calendar.app's own order", () => {
  const report = parseHelperReport(
    JSON.stringify({
      access: APPLE_CALENDAR_ACCESS.FULL,
      calendars: [
        { id: "subscribed", label: "Holidays", group: "Subscribed" },
        { id: "personal", label: "Personal", group: "iCloud" },
        { id: "team", label: "Team", group: "Google" },
        { id: "work", label: "Work", group: "iCloud" },
      ],
    }),
  );
  assert.deepEqual(
    report.calendars.map((calendar) => calendar.id),
    ["team", "personal", "work", "subscribed"],
  );
  assert.equal(report.calendars[0]?.group, "Google");
});

test("the list is bounded the way the Google list is", () => {
  const report = parseHelperReport(
    JSON.stringify({
      access: APPLE_CALENDAR_ACCESS.FULL,
      calendars: [
        { id: "long", label: "x".repeat(200), color: "#12345", group: "g".repeat(90) },
        { id: "styled", label: "Styled", color: "#A1B2C3" },
        { id: "styled", label: "Twice" },
        { id: "", label: "Nameless" },
        ...Array.from({ length: 60 }, (_, index) => ({ id: `extra-${index}` })),
      ],
    }),
  );
  assert.equal(report.calendars.length, 50);
  const long = report.calendars.find((calendar) => calendar.id === "long");
  assert.equal(long?.label.length, 80);
  assert.equal(long?.group?.length, 40);
  // A colour is the one listed value that becomes a style; a malformed one is
  // dropped, and a well-formed one carried.
  assert.equal(long?.color, undefined);
  assert.equal(report.calendars.find((calendar) => calendar.id === "styled")?.color, "#A1B2C3");
  assert.equal(report.calendars.filter((calendar) => calendar.id === "styled").length, 1);
  // An entry with no id names nothing and is not a calendar.
  assert.ok(!report.calendars.some((calendar) => calendar.label === "Nameless"));
});

test("access withdrawn empties the calendar rather than standing what it held", async () => {
  let answer: () => string | Error = fullAccessAnswer;
  const { reader } = readerFor({
    connection: { selectedCalendarIds: ["work"] },
    answer: () => answer(),
  });

  const first = await reader.observe();
  assert.equal(first?.meetings.length, 2);

  // The system's own answer takes the calendars and meetings with it:
  // nothing may keep standing — or keep holding announcements — on consent
  // the user just took back in System Settings.
  answer = () => JSON.stringify({ access: APPLE_CALENDAR_ACCESS.DENIED });
  const withdrawn = await reader.observe();
  assert.match(withdrawn?.failure ?? "", /System Settings/);
  assert.deepEqual(withdrawn?.meetings, []);
  assert.deepEqual(withdrawn?.calendars, []);
  assert.equal(withdrawn?.revoked, true);

  // A transient failure after the withdrawal stands the emptiness — and the
  // withdrawal itself — never resurrecting what it took, nor dressing the
  // row back up as connected.
  answer = () => new Error("helper went away");
  const failed = await reader.observe();
  assert.deepEqual(failed?.meetings, []);
  assert.equal(failed?.revoked, true);
  assert.match(failed?.failure ?? "", /helper went away/);
});

test("a helper that fails or answers unreadably stands the last observation", async () => {
  let answer: () => string | Error = fullAccessAnswer;
  const { reader } = readerFor({
    connection: { selectedCalendarIds: ["work"] },
    answer: () => answer(),
  });
  const first = await reader.observe();

  answer = () => new Error("helper went away");
  const failed = await reader.observe();
  assert.match(failed?.failure ?? "", /helper went away/);
  assert.deepEqual(failed?.meetings, first?.meetings);

  answer = () => "not json at all";
  const unreadable = await reader.observe();
  assert.match(unreadable?.failure ?? "", /answered unreadably/);
  assert.deepEqual(unreadable?.meetings, first?.meetings);
});

test("forget clears what a failing pass would otherwise stand", async () => {
  let healthy = true;
  const { reader } = readerFor({
    connection: { selectedCalendarIds: ["work"] },
    answer: () => (healthy ? fullAccessAnswer() : new Error("helper went away")),
  });
  await reader.observe();
  reader.forget();

  healthy = false;
  const observation = await reader.observe();
  assert.deepEqual(observation?.meetings, []);
  assert.deepEqual(observation?.calendars, []);
  assert.match(observation?.failure ?? "", /helper went away/);
});

test("the status probe asks without prompting and answers the access word", async () => {
  const { reader, runs } = readerFor({
    answer: () => JSON.stringify({ access: APPLE_CALENDAR_ACCESS.WRITE_ONLY }),
  });
  assert.equal(await reader.status(), APPLE_CALENDAR_ACCESS.WRITE_ONLY);
  assert.deepEqual(runs[0]?.helperArguments, ["status"]);
});

test("requestAccess runs the one prompting command and reports the seed", async () => {
  const { reader, runs } = readerFor({
    answer: () =>
      JSON.stringify({
        access: APPLE_CALENDAR_ACCESS.FULL,
        calendars: [{ id: "work", label: "Work" }],
        defaultCalendarId: "work",
      }),
  });

  const outcome = await reader.requestAccess();
  assert.deepEqual(runs[0]?.helperArguments, ["request-access"]);
  // The consent dialog waits on the user's hands, so the ask outwaits a read.
  assert.ok((runs[0]?.timeoutMs ?? 0) > 10_000);
  assert.equal(outcome.access, APPLE_CALENDAR_ACCESS.FULL);
  assert.equal(outcome.defaultCalendarId, "work");
  assert.deepEqual(outcome.calendars, [{ id: "work", label: "Work" }]);
});

test("a refused grant comes back as its status, never as a throw", async () => {
  const { reader } = readerFor({
    answer: () => JSON.stringify({ access: APPLE_CALENDAR_ACCESS.DENIED }),
  });
  const outcome = await reader.requestAccess();
  assert.equal(outcome.access, APPLE_CALENDAR_ACCESS.DENIED);
  assert.deepEqual(outcome.calendars, []);
  assert.equal(outcome.failure, undefined);
});

test("a cancelled ask ends where it stands, without opening System Settings", async () => {
  const { reader, runs } = readerFor({
    answer: () => JSON.stringify({ access: APPLE_CALENDAR_ACCESS.DENIED }),
  });
  let opened = 0;
  const outcome = await reader.obtainAccess({
    openSystemSettings: () => {
      opened += 1;
    },
    superseded: () => true,
  });
  assert.equal(outcome.access, APPLE_CALENDAR_ACCESS.DENIED);
  assert.equal(opened, 0);
  assert.equal(runs.length, 1);
});

test("an ask that failed on its own carries the helper's why", async () => {
  const { reader } = readerFor({
    answer: () =>
      JSON.stringify({
        access: APPLE_CALENDAR_ACCESS.NOT_DETERMINED,
        failure: "macOS suppressed the consent dialog for the helper's own identity",
      }),
  });
  const outcome = await reader.requestAccess();
  assert.equal(outcome.access, APPLE_CALENDAR_ACCESS.NOT_DETERMINED);
  assert.match(outcome.failure ?? "", /suppressed the consent dialog/);
});
