import assert from "node:assert/strict";
import test from "node:test";
import {
  compareSessionsByUrgency,
  MOTION_DURATION_MS,
  SESSION_URGENCY,
  urgencyLabel,
} from "../src";
import { URGENCY_LABEL, URGENCY_PRIORITY } from "../src/session-display";

test("every display urgency has a label, and the priority list is a permutation of them", () => {
  assert.deepEqual(new Set(Object.keys(URGENCY_LABEL)), new Set(Object.values(SESSION_URGENCY)));
  assert.deepEqual(new Set(URGENCY_PRIORITY), new Set(Object.values(SESSION_URGENCY)));
  assert.equal(URGENCY_PRIORITY.length, Object.values(SESSION_URGENCY).length);
  for (const urgency of Object.values(SESSION_URGENCY)) {
    assert.equal(urgencyLabel(urgency), URGENCY_LABEL[urgency]);
  }
});

test("urgency puts attention first, then working, complete, and idle", () => {
  const idle = { urgency: SESSION_URGENCY.UNKNOWN, observedAt: 3 };
  const working = { urgency: SESSION_URGENCY.WORKING, observedAt: 2 };
  const attention = { urgency: SESSION_URGENCY.ATTENTION, observedAt: 1 };
  const complete = { urgency: SESSION_URGENCY.COMPLETE, observedAt: 4 };
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
  const older = { urgency: SESSION_URGENCY.WORKING, observedAt: 1 };
  const newer = { urgency: SESSION_URGENCY.WORKING, observedAt: 2 };
  assert.equal(compareSessionsByUrgency(newer, older), -1);
});

test("collapse waits out exit then shape, matching the CSS token pair", () => {
  assert.equal(MOTION_DURATION_MS.EXIT + MOTION_DURATION_MS.SHAPE, 550);
});
