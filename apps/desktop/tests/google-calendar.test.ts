import assert from "node:assert/strict";
import test from "node:test";
import { type CalendarAccountCredential, GoogleCalendarReader } from "../src/google-calendar";
import { HTTP_STATUS, type RecordedRequest, recordingFetch } from "./support/http-fake";

const NOW = Date.UTC(2026, 7, 17, 12, 0, 0);

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";

const WORK_ACCOUNT: CalendarAccountCredential = {
  id: "work@example.com",
  refreshToken: "1//work-grant",
  selectedCalendarIds: ["work@example.com", "team-calendar"],
};

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: HTTP_STATUS.OK,
    headers: { "content-type": "application/json" },
  });
}

function routes(request: RecordedRequest): Response {
  if (request.url === TOKEN_URL) {
    const grant = new URLSearchParams(request.body ?? "").get("refresh_token") ?? "";
    return jsonOk({ access_token: `at-for-${grant}`, expires_in: 3599 });
  }
  if (request.url === CALENDAR_LIST_URL) {
    return jsonOk({
      items: [
        { id: "work@example.com", summary: "Meetings", primary: true, backgroundColor: "#9FE1E7" },
        { id: "team-calendar", summary: "Team", backgroundColor: "#f83a22" },
        // Nameless still counts; its id stands in for the label — and a
        // colour that is not a colour is dropped, never styled with.
        { id: "ops-calendar", backgroundColor: "javascript:alert(1)" },
      ],
    });
  }
  if (request.url === FREEBUSY_URL) {
    return jsonOk({
      calendars: {
        "work@example.com": {
          busy: [{ start: "2026-08-17T13:00:00Z", end: "2026-08-17T14:00:00Z" }],
        },
        "team-calendar": {
          busy: [{ start: "2026-08-17T15:00:00Z", end: "2026-08-17T15:30:00Z" }],
        },
      },
    });
  }
  return new Response("", { status: 404 });
}

function readerWith(
  respond: (request: RecordedRequest) => Response,
  accounts: readonly CalendarAccountCredential[],
): { reader: GoogleCalendarReader; requests: RecordedRequest[] } {
  const { fetch, requests } = recordingFetch(respond);
  const reader = new GoogleCalendarReader({
    readAccounts: async () => accounts,
    signInConfig: () => ({ clientId: "test-client.apps.googleusercontent.com" }),
    fetchImplementation: fetch as typeof globalThis.fetch,
    now: () => NOW,
  });
  return { reader, requests };
}

test("with no accounts it observes nothing and issues no request", async () => {
  const { reader, requests } = readerWith(routes, []);

  assert.equal(await reader.observe(), undefined);
  assert.deepEqual(requests, []);
});

test("an account's pass lists its calendars and reads only their busy times", async () => {
  const { reader, requests } = readerWith(routes, [WORK_ACCOUNT]);

  const observed = await reader.observe();

  assert.deepEqual(observed, [
    {
      accountId: "work@example.com",
      // The primary calendar first, the rest by name — never Google's own
      // list order, which owes the rows no stability.
      calendars: [
        { id: "work@example.com", label: "Meetings", color: "#9FE1E7" },
        { id: "ops-calendar", label: "ops-calendar" },
        { id: "team-calendar", label: "Team", color: "#f83a22" },
      ],
      meetings: [
        { startsAt: Date.UTC(2026, 7, 17, 13), endsAt: Date.UTC(2026, 7, 17, 14) },
        { startsAt: Date.UTC(2026, 7, 17, 15), endsAt: Date.UTC(2026, 7, 17, 15, 30) },
      ],
    },
  ]);
  // Token mint, calendar list, then the one free/busy read — nothing else.
  assert.deepEqual(
    requests.map((request) => request.url),
    [TOKEN_URL, CALENDAR_LIST_URL, FREEBUSY_URL],
  );
  const read = JSON.parse(requests[2]?.body ?? "{}");
  assert.deepEqual(read.items, [{ id: "work@example.com" }, { id: "team-calendar" }]);
  assert.equal(requests[2]?.authorization, "Bearer at-for-1//work-grant");
});

test("a selection the list no longer names never enters the read document", async () => {
  const { reader, requests } = readerWith(routes, [
    { ...WORK_ACCOUNT, selectedCalendarIds: ["team-calendar", "a-calendar-long-gone"] },
  ]);

  await reader.observe();

  const read = JSON.parse(requests[2]?.body ?? "{}");
  assert.deepEqual(read.items, [{ id: "team-calendar" }]);
});

test("nothing selected means no free/busy read at all", async () => {
  const { reader, requests } = readerWith(routes, [{ ...WORK_ACCOUNT, selectedCalendarIds: [] }]);

  const observed = await reader.observe();

  assert.deepEqual(observed?.[0]?.meetings, []);
  assert.deepEqual(
    requests.map((request) => request.url),
    [TOKEN_URL, CALENDAR_LIST_URL],
  );
});

test("every connected account is read, and their meetings stand apart", async () => {
  const home: CalendarAccountCredential = {
    id: "home@example.com",
    refreshToken: "1//home-grant",
    selectedCalendarIds: ["home@example.com"],
  };
  const { reader, requests } = readerWith(
    (request) => {
      if (request.url === CALENDAR_LIST_URL && request.authorization?.includes("home")) {
        return jsonOk({ items: [{ id: "home@example.com", summary: "Home", primary: true }] });
      }
      if (request.url === FREEBUSY_URL && request.authorization?.includes("home")) {
        return jsonOk({
          calendars: {
            "home@example.com": {
              busy: [{ start: "2026-08-17T18:00:00Z", end: "2026-08-17T19:00:00Z" }],
            },
          },
        });
      }
      return routes(request);
    },
    [WORK_ACCOUNT, home],
  );

  const observed = await reader.observe();

  assert.equal(observed?.length, 2);
  assert.equal(observed?.[1]?.accountId, "home@example.com");
  assert.deepEqual(observed?.[1]?.meetings, [
    { startsAt: Date.UTC(2026, 7, 17, 18), endsAt: Date.UTC(2026, 7, 17, 19) },
  ]);
  // Each account's read rides its own grant's token.
  const freebusyAuths = requests
    .filter((request) => request.url === FREEBUSY_URL)
    .map((request) => request.authorization);
  assert.deepEqual(freebusyAuths, ["Bearer at-for-1//work-grant", "Bearer at-for-1//home-grant"]);
});

test("the access token is cached across passes under the same grant", async () => {
  const { reader, requests } = readerWith(routes, [WORK_ACCOUNT]);

  await reader.observe();
  await reader.observe();

  assert.equal(requests.filter((request) => request.url === TOKEN_URL).length, 1);
});

test("a revoked grant is a failure naming the account, not a quieter calendar", async () => {
  const { reader } = readerWith(
    (request) =>
      request.url === TOKEN_URL
        ? new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })
        : routes(request),
    [WORK_ACCOUNT],
  );

  const observed = await reader.observe();

  assert.match(observed?.[0]?.failure ?? "", /work@example\.com.*connect the account again/);
  assert.deepEqual(observed?.[0]?.meetings, []);
});

test("one bad account never blinds the others, and keeps what it last showed", async () => {
  const home: CalendarAccountCredential = {
    id: "home@example.com",
    refreshToken: "1//home-grant",
    selectedCalendarIds: [],
  };
  // Work reads fine on the first pass and stops answering on the second;
  // home answers throughout.
  let workBroken = false;
  const { reader } = readerWith(
    (request) => {
      if (request.url === CALENDAR_LIST_URL && request.authorization?.includes("work")) {
        if (workBroken) return new Response("", { status: 500 });
        return routes(request);
      }
      if (request.url === CALENDAR_LIST_URL) {
        return jsonOk({ items: [{ id: "home@example.com", summary: "Home", primary: true }] });
      }
      return routes(request);
    },
    [WORK_ACCOUNT, home],
  );

  const first = await reader.observe();
  assert.equal(first?.[0]?.failure, undefined);
  workBroken = true;
  const second = await reader.observe();

  assert.equal(second?.length, 2);
  // Work answers with what it last showed, and why it cannot answer now.
  assert.match(second?.[0]?.failure ?? "", /work@example\.com/);
  assert.deepEqual(second?.[0]?.calendars, first?.[0]?.calendars);
  assert.deepEqual(second?.[0]?.meetings, first?.[0]?.meetings);
  // Home still reads, untouched by work's failure.
  assert.equal(second?.[1]?.accountId, "home@example.com");
  assert.equal(second?.[1]?.failure, undefined);
});

test("listCalendars names the primary first, then the rest by name", async () => {
  const { reader } = readerWith(routes, []);

  const calendars = await reader.listCalendars("at-fresh");

  assert.deepEqual(calendars, [
    { id: "work@example.com", label: "Meetings", color: "#9FE1E7", primary: true },
    { id: "ops-calendar", label: "ops-calendar", primary: false },
    { id: "team-calendar", label: "Team", color: "#f83a22", primary: false },
  ]);
});
