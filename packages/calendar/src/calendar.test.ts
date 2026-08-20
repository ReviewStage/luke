import assert from "node:assert/strict";
import test from "node:test";
import {
  activeMeetingEnd,
  CALENDAR_LOOKAHEAD_MS,
  MAXIMUM_CALENDAR_MEETINGS,
  meetingsFromBusyIntervals,
  nextMeetingBoundary,
} from "@sidecar/calendar";
import type { UnparsedWireValue } from "@sidecar/wire";

/** Noon UTC on a fixed Monday, so every expectation is a plain number. */
const NOW = Date.UTC(2026, 7, 17, 12, 0, 0);

test("a free/busy answer normalizes to bounded meetings", () => {
  const busy: UnparsedWireValue = [
    { start: "2026-08-17T13:00:00Z", end: "2026-08-17T14:00:00Z" },
    // Already underway still matters; already over does not.
    { start: "2026-08-17T11:30:00Z", end: "2026-08-17T12:30:00Z" },
    { start: "2026-08-17T09:00:00Z", end: "2026-08-17T10:00:00Z" },
    // Beyond the look-ahead.
    { start: "2026-09-01T13:00:00Z", end: "2026-09-01T14:00:00Z" },
    // Longer than a meeting can be: an out-of-office block, not a meeting.
    { start: "2026-08-17T12:30:00Z", end: "2026-08-18T13:00:00Z" },
    // Not intervals at all: an untrusted answer proves nothing by its shape.
    { start: "2026-08-17T13:00:00Z" },
    { start: "not-a-time", end: "2026-08-17T14:00:00Z" },
    { start: 5, end: 6 },
    "busy",
    null,
  ];

  assert.deepEqual(meetingsFromBusyIntervals(busy, NOW), [
    { startsAt: Date.UTC(2026, 7, 17, 11, 30), endsAt: Date.UTC(2026, 7, 17, 12, 30) },
    { startsAt: Date.UTC(2026, 7, 17, 13), endsAt: Date.UTC(2026, 7, 17, 14) },
  ]);
  assert.deepEqual(meetingsFromBusyIntervals("not-a-list", NOW), []);
  assert.deepEqual(meetingsFromBusyIntervals(undefined, NOW), []);
});

test("the meeting list is bounded", () => {
  const busy = Array.from({ length: MAXIMUM_CALENDAR_MEETINGS + 20 }, (_, index) => ({
    start: new Date(NOW + index * 300_000).toISOString(),
    end: new Date(NOW + index * 300_000 + 60_000).toISOString(),
  }));

  const meetings = meetingsFromBusyIntervals(busy, NOW);

  assert.equal(meetings.length, MAXIMUM_CALENDAR_MEETINGS);
  for (const meeting of meetings) {
    assert.ok(meeting.startsAt <= NOW + CALENDAR_LOOKAHEAD_MS);
  }
});

test("activeMeetingEnd answers only inside a meeting", () => {
  const meetings = [
    { startsAt: 1_000, endsAt: 2_000 },
    { startsAt: 1_500, endsAt: 3_000 },
    { startsAt: 5_000, endsAt: 6_000 },
  ];

  assert.equal(activeMeetingEnd(meetings, 500), undefined);
  // Overlapping meetings quiet until the later end.
  assert.equal(activeMeetingEnd(meetings, 1_600), 3_000);
  assert.equal(activeMeetingEnd(meetings, 2_500), 3_000);
  // The gap between blocks is not a meeting.
  assert.equal(activeMeetingEnd(meetings, 4_000), undefined);
  assert.equal(activeMeetingEnd(meetings, 5_000), 6_000);
  // An end is an end, not a last covered instant.
  assert.equal(activeMeetingEnd(meetings, 6_000), undefined);
  assert.equal(activeMeetingEnd([], 1_000), undefined);
});

test("nextMeetingBoundary names the earliest edge still ahead", () => {
  const meetings = [
    { startsAt: 1_000, endsAt: 2_000 },
    { startsAt: 1_500, endsAt: 3_000 },
    { startsAt: 5_000, endsAt: 6_000 },
  ];

  // Before anything: the first start is the next edge.
  assert.equal(nextMeetingBoundary(meetings, 500), 1_000);
  // Inside the overlap, the inner end is still an edge — not every edge
  // changes the answer, but every change happens at one.
  assert.equal(nextMeetingBoundary(meetings, 1_600), 2_000);
  assert.equal(nextMeetingBoundary(meetings, 2_500), 3_000);
  // The gap looks ahead to the next start; an instant is never its own edge.
  assert.equal(nextMeetingBoundary(meetings, 3_000), 5_000);
  assert.equal(nextMeetingBoundary(meetings, 5_500), 6_000);
  // Past the last end there is nothing left to wait for.
  assert.equal(nextMeetingBoundary(meetings, 6_000), undefined);
  assert.equal(nextMeetingBoundary([], 1_000), undefined);
});
