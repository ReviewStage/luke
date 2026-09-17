import assert from "node:assert/strict";
import { SESSION_URGENCY } from "@sidecar/session";
import { compareSessionsByUrgency } from "@sidecar/surface";
import { test } from "vitest";

test("urgency puts attention first, then working, complete, and idle", () => {
  const idle = { urgency: SESSION_URGENCY.UNKNOWN, lastActivityAt: 3 };
  const working = { urgency: SESSION_URGENCY.WORKING, lastActivityAt: 2 };
  const attention = { urgency: SESSION_URGENCY.ATTENTION, lastActivityAt: 1 };
  const complete = { urgency: SESSION_URGENCY.COMPLETE, lastActivityAt: 4 };
  assert.deepEqual(
    [idle, working, attention, complete]
      .toSorted(compareSessionsByUrgency)
      .map((row) => row.urgency),
    [
      SESSION_URGENCY.ATTENTION,
      SESSION_URGENCY.WORKING,
      SESSION_URGENCY.COMPLETE,
      SESSION_URGENCY.UNKNOWN,
    ],
  );
});

test("within one urgency, the session that moved most recently comes first", () => {
  const older = { urgency: SESSION_URGENCY.WORKING, lastActivityAt: 1 };
  const newer = { urgency: SESSION_URGENCY.WORKING, lastActivityAt: 2 };
  assert.equal(compareSessionsByUrgency(newer, older), -1);
});
