import assert from "node:assert/strict";
import { test } from "vitest";
import {
  activeUntilFrom,
  DEVICE_POLL_INTERVAL_MS,
  PRESENCE_RULE,
  quietUntilFrom,
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
