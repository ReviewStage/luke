import assert from "node:assert/strict";
import test from "node:test";
import { calendarConnectNote } from "../src/renderer/settings-panel";
import { CALENDAR_ACCESS } from "../src/shared/contracts";

test("the row says the one line it was asked for", () => {
  // Whether a calendar is subscribed to or not, the promise is the same and it
  // is the whole of the row's second line.
  assert.equal(
    calendarConnectNote(CALENDAR_ACCESS.UNKNOWN, 0),
    "Luke won't notify you during calendar events.",
  );
  assert.equal(
    calendarConnectNote(CALENDAR_ACCESS.GRANTED, 2),
    "Luke won't notify you during calendar events.",
  );
});

test("a subscription that stopped answering says so", () => {
  // The one state worth explaining: a row that looks connected and is doing
  // nothing. Before anything is subscribed there is nothing to explain.
  assert.equal(
    calendarConnectNote(CALENDAR_ACCESS.UNAVAILABLE, 1),
    "These calendars cannot be read just now.",
  );
  assert.equal(
    calendarConnectNote(CALENDAR_ACCESS.UNAVAILABLE, 0),
    "Luke won't notify you during calendar events.",
  );
});

test("every note the row draws is one short line", () => {
  const notes = [
    calendarConnectNote(CALENDAR_ACCESS.UNKNOWN, 0),
    calendarConnectNote(CALENDAR_ACCESS.GRANTED, 2),
    calendarConnectNote(CALENDAR_ACCESS.UNAVAILABLE, 1),
  ];

  // The row is a control, not the documentation: a second line under it wraps
  // the section open and reads as prose.
  for (const note of notes) {
    assert.ok(note.length <= 60, `"${note}" is ${note.length} characters`);
    assert.equal(note.includes("\n"), false);
  }
});
