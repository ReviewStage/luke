import assert from "node:assert/strict";
import { test } from "vitest";
import { activeUntilFrom, DEVICE_POLL_INTERVAL_MS, PRESENCE_RULE } from "./device-presence.js";

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
