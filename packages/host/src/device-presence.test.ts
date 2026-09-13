import assert from "node:assert/strict";
import { test } from "vitest";
import {
  activeUntilFrom,
  DEVICE_POLL_INTERVAL_MS,
  openEndedQuietUntil,
  PRESENCE_RULE,
  QUIET_HOLD_RULE,
  quietUntilFrom,
  reportedQuietUntil,
} from "./device-presence.js";

const NOW = Date.parse("2026-09-11T12:00:00.000Z");

test("presence holds only while input is recent and the screen is unlocked, both at once", () => {
  assert.equal(
    activeUntilFrom({ idleSeconds: 0, screenLocked: false }, NOW),
    NOW + PRESENCE_RULE.ACTIVE_WINDOW_MS,
  );
  assert.equal(
    activeUntilFrom(
      { idleSeconds: PRESENCE_RULE.IDLE_LIMIT_SECONDS - 1, screenLocked: false },
      NOW,
    ),
    NOW + PRESENCE_RULE.ACTIVE_WINDOW_MS,
  );
  assert.equal(
    activeUntilFrom({ idleSeconds: PRESENCE_RULE.IDLE_LIMIT_SECONDS, screenLocked: false }, NOW),
    null,
  );
  assert.equal(activeUntilFrom({ idleSeconds: 0, screenLocked: true }, NOW), null);
  assert.equal(activeUntilFrom(undefined, NOW), null);
});

test("the window presence is claimed for outlasts one missed poll and not two", () => {
  assert.equal(PRESENCE_RULE.ACTIVE_WINDOW_MS, 2 * DEVICE_POLL_INTERVAL_MS);
  assert.ok(PRESENCE_RULE.ACTIVE_WINDOW_MS > DEVICE_POLL_INTERVAL_MS);
});

const MEETING = { startsAt: NOW - 600_000, endsAt: NOW + 1_200_000 };

test("the quiet instant is the covering meeting's end under the setting, null once observed with none standing, and absent before any observation", () => {
  assert.equal(quietUntilFrom([MEETING], true, NOW), MEETING.endsAt);
  assert.equal(quietUntilFrom([MEETING], false, NOW), null);
  assert.equal(quietUntilFrom([MEETING], true, MEETING.endsAt), null);
  assert.equal(quietUntilFrom([], true, NOW), null);
  assert.equal(quietUntilFrom(undefined, true, NOW), undefined);
  assert.equal(quietUntilFrom(undefined, false, NOW), undefined);
});

test("only the unobserved state is absent from the report: the other two are the instant or null", () => {
  const reported = [
    quietUntilFrom(undefined, true, NOW),
    quietUntilFrom([], true, NOW),
    quietUntilFrom([MEETING], true, NOW),
  ];
  assert.deepEqual(reported, [undefined, null, MEETING.endsAt]);
  assert.deepEqual(
    reported.map((value) => value === undefined),
    [true, false, false],
  );
});

const NO_HOLD = { paused: false, introductionOwed: false } as const;
const PAUSED = { paused: true, introductionOwed: false } as const;
const INTRODUCING = { paused: false, introductionOwed: true } as const;
const BOTH = { paused: true, introductionOwed: true } as const;

test("an open-ended hold is restated as the second step boundary: at least one step ahead, at most two, moving once a step", () => {
  const step = QUIET_HOLD_RULE.STEP_MS;
  const boundary = Math.floor(NOW / step) * step;
  assert.equal(openEndedQuietUntil(NOW), boundary + 2 * step);
  assert.equal(openEndedQuietUntil(NOW + DEVICE_POLL_INTERVAL_MS), boundary + 2 * step);
  assert.equal(openEndedQuietUntil(NOW + step - 1), boundary + 2 * step);
  assert.equal(openEndedQuietUntil(NOW + step), boundary + 3 * step);
  for (const at of [NOW, NOW + 1, NOW + step - 1, NOW + step, NOW + 7 * DEVICE_POLL_INTERVAL_MS]) {
    const ahead = openEndedQuietUntil(at) - at;
    assert.ok(ahead >= step, `the instant at ${at} lapses before the next step`);
    assert.ok(ahead <= 2 * step, `the instant at ${at} outlives two steps`);
    assert.ok(ahead > DEVICE_POLL_INTERVAL_MS, "a beat's instant outlasts the beat after it");
  }
});

test("with no hold of the Mac's own the meeting's three states pass through untouched", () => {
  assert.equal(reportedQuietUntil(undefined, NO_HOLD, NOW), undefined);
  assert.equal(reportedQuietUntil(null, NO_HOLD, NOW), null);
  assert.equal(reportedQuietUntil(MEETING.endsAt, NO_HOLD, NOW), MEETING.endsAt);
});

test("the pause alone and the introduction alone each report the open-ended instant, whether or not the calendars were observed", () => {
  const held = openEndedQuietUntil(NOW);
  for (const holds of [PAUSED, INTRODUCING, BOTH]) {
    assert.equal(reportedQuietUntil(undefined, holds, NOW), held);
    assert.equal(reportedQuietUntil(null, holds, NOW), held);
  }
});

test("the latest instant wins: a meeting ending after the stepped instant holds to its end, one ending before it does not shorten the hold", () => {
  const held = openEndedQuietUntil(NOW);
  const longMeeting = held + 30 * 60_000;
  const shortMeeting = MEETING.endsAt;
  assert.ok(shortMeeting < held);
  for (const holds of [PAUSED, INTRODUCING, BOTH]) {
    assert.equal(reportedQuietUntil(longMeeting, holds, NOW), longMeeting);
    assert.equal(reportedQuietUntil(shortMeeting, holds, NOW), held);
  }
  assert.equal(reportedQuietUntil(longMeeting, NO_HOLD, NOW), longMeeting);
});

test("releasing every hold of the Mac's own reports the meeting's state again, null included", () => {
  assert.equal(reportedQuietUntil(null, BOTH, NOW), openEndedQuietUntil(NOW));
  assert.equal(reportedQuietUntil(null, NO_HOLD, NOW), null);
});
