import assert from "node:assert/strict";
import test from "node:test";
import {
  type CalendarEvent,
  MEETING_PARTICIPATION,
  type MeetingParticipation,
} from "../src/meeting-events";
import {
  isMeeting,
  MAXIMUM_MEETING_MS,
  MEETING_EDGE_MAX_MS,
  MeetingPresence,
} from "../src/meeting-presence";
import { CALENDAR_ACCESS, MEETING_STATUS, type MeetingState } from "../src/shared/contracts";

const NOON = Date.parse("2026-08-14T12:00:00Z");
const MINUTE = 60_000;

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    start: NOON - 5 * MINUTE,
    end: NOON + 25 * MINUTE,
    allDay: false,
    participation: MEETING_PARTICIPATION.ACCEPTED,
    others: 2,
    canceled: false,
    ...overrides,
  };
}

interface Held {
  presence: MeetingPresence;
  states: MeetingState[];
  travel: (to: number) => void;
}

function harness(): Held {
  const states: MeetingState[] = [];
  let now = NOON;
  const presence = new MeetingPresence({
    onChanged: (state) => states.push(state),
    now: () => now,
  });
  return {
    presence,
    states,
    travel: (to) => {
      now = to;
    },
  };
}

test("a meeting is happening now, with someone else, for an hour or so", () => {
  assert.equal(isMeeting(event()), true);
  // Tentative is still a plan, and the person who called the meeting is at it
  // however their own attendee row reads. An event on the developer's calendar
  // that mentions them nowhere is a meeting too — it has other people on it,
  // and they have not said otherwise.
  for (const participation of [
    MEETING_PARTICIPATION.TENTATIVE,
    MEETING_PARTICIPATION.ORGANIZER,
    MEETING_PARTICIPATION.UNKNOWN,
  ] satisfies MeetingParticipation[]) {
    assert.equal(isMeeting(event({ participation })), true, participation);
  }
});

test("what is not a meeting is refused, and every refusal errs towards speaking", () => {
  // A day is not an hour anyone is speaking in: holding for one holds until
  // tomorrow.
  assert.equal(isMeeting(event({ allDay: true })), false);
  // Nobody to talk over. Focus blocks, reminders, flights, and a calendar kept
  // as a to-do list all land here, which is what stops one silencing Luke for
  // good.
  assert.equal(isMeeting(event({ others: 0 })), false);
  // Said no, and never answered. A silence imposed on the strength of a
  // question the developer left open is a silence they never agreed to.
  assert.equal(isMeeting(event({ participation: MEETING_PARTICIPATION.DECLINED })), false);
  assert.equal(isMeeting(event({ participation: MEETING_PARTICIPATION.PENDING })), false);
  // Handed to somebody else, or already marked done: both are answers, and
  // both say the developer is not expected there.
  assert.equal(isMeeting(event({ participation: MEETING_PARTICIPATION.EXCUSED })), false);
  assert.equal(isMeeting(event({ canceled: true })), false);
  // Past a few hours an entry describes a day rather than a conversation.
  assert.equal(isMeeting(event({ start: NOON, end: NOON + MAXIMUM_MEETING_MS + MINUTE })), false);
  assert.equal(isMeeting(event({ start: NOON, end: NOON + MAXIMUM_MEETING_MS })), true);
  // A marker with no length is not a stretch of time to wait out.
  assert.equal(isMeeting(event({ start: NOON, end: NOON })), false);
});

test("a granted calendar with nothing happening is off, not unavailable", () => {
  const held = harness();
  held.presence.setReading({
    access: CALENDAR_ACCESS.GRANTED,
    events: [event({ start: NOON + MINUTE, end: NOON + 30 * MINUTE })],
  });

  assert.deepEqual(held.presence.state, {
    status: MEETING_STATUS.OFF,
    access: CALENDAR_ACCESS.GRANTED,
  });
});

test("an unreadable calendar is never a calendar with nothing on it", () => {
  const held = harness();
  // Never asked, which is what every build says until the switch goes on.
  assert.deepEqual(held.presence.state, {
    status: MEETING_STATUS.UNAVAILABLE,
    access: CALENDAR_ACCESS.UNKNOWN,
  });

  held.presence.setReading(undefined);
  assert.deepEqual(held.presence.state, {
    status: MEETING_STATUS.UNAVAILABLE,
    access: CALENDAR_ACCESS.UNAVAILABLE,
  });

  // A refusal is an answer about access and no answer at all about meetings,
  // so it holds nothing back either.
  held.presence.setReading({ access: CALENDAR_ACCESS.DENIED, events: [event()] });
  assert.deepEqual(held.presence.state, {
    status: MEETING_STATUS.UNAVAILABLE,
    access: CALENDAR_ACCESS.DENIED,
  });
});

test("the clock is what starts and ends the meeting, not the reading", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const held = harness();
  held.presence.setReading({
    access: CALENDAR_ACCESS.GRANTED,
    events: [event({ start: NOON + MINUTE, end: NOON + 2 * MINUTE })],
  });
  assert.equal(held.presence.state.status, MEETING_STATUS.OFF);

  // The gate schedules itself on the event's own start, so nothing has to
  // arrive for the meeting to begin — no reading, no model, no decision, just
  // the boundary the event itself carries. The wait is capped at a minute so a
  // Mac that slept through one wakes into a timer that is already overdue.
  held.travel(NOON + MINUTE);
  t.mock.timers.tick(MEETING_EDGE_MAX_MS);
  assert.equal(held.presence.state.status, MEETING_STATUS.ON);

  held.travel(NOON + 2 * MINUTE);
  t.mock.timers.tick(MEETING_EDGE_MAX_MS);
  assert.equal(held.presence.state.status, MEETING_STATUS.OFF);

  assert.deepEqual(
    held.states.map((state) => state.status),
    [MEETING_STATUS.OFF, MEETING_STATUS.ON, MEETING_STATUS.OFF],
  );
  held.presence.stop();
});

test("forgetting the calendar says so, rather than saying there is no meeting", () => {
  const held = harness();
  held.presence.setReading({ access: CALENDAR_ACCESS.GRANTED, events: [event()] });
  assert.equal(held.presence.state.status, MEETING_STATUS.ON);

  // The switch coming off stops the watching, and what is true again is that
  // nobody has looked — not that the meeting ended.
  held.presence.reset();
  assert.deepEqual(held.presence.state, {
    status: MEETING_STATUS.UNAVAILABLE,
    access: CALENDAR_ACCESS.UNKNOWN,
  });
});

test("only changes are announced", () => {
  const held = harness();
  const reading = { access: CALENDAR_ACCESS.GRANTED, events: [event()] } as const;
  held.presence.setReading(reading);
  held.presence.setReading({ ...reading, events: [event(), event({ others: 5 })] });

  assert.equal(held.states.length, 1);
  held.presence.stop();
});
