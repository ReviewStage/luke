import assert from "node:assert/strict";
import test from "node:test";
import {
  compareSessionsByUrgency,
  MOTION_DURATION_MS,
  SESSION_STATE,
  STATE_LABEL,
  STATE_PRIORITY,
} from "../src";

test("every display state has a label, and the priority list is a permutation of them", () => {
  assert.deepEqual(new Set(Object.keys(STATE_LABEL)), new Set(Object.values(SESSION_STATE)));
  assert.deepEqual(new Set(STATE_PRIORITY), new Set(Object.values(SESSION_STATE)));
  assert.equal(STATE_PRIORITY.length, Object.values(SESSION_STATE).length);
});

test("urgency puts attention first, then working, complete, and idle", () => {
  const idle = { state: SESSION_STATE.UNKNOWN, observedAt: 3 };
  const working = { state: SESSION_STATE.WORKING, observedAt: 2 };
  const attention = { state: SESSION_STATE.ATTENTION, observedAt: 1 };
  const complete = { state: SESSION_STATE.COMPLETE, observedAt: 4 };
  assert.deepEqual(
    [idle, working, attention, complete].toSorted(compareSessionsByUrgency).map((row) => row.state),
    [SESSION_STATE.ATTENTION, SESSION_STATE.WORKING, SESSION_STATE.COMPLETE, SESSION_STATE.UNKNOWN],
  );
});

test("within one state, the session that moved most recently comes first", () => {
  const older = { state: SESSION_STATE.WORKING, observedAt: 1 };
  const newer = { state: SESSION_STATE.WORKING, observedAt: 2 };
  assert.equal(compareSessionsByUrgency(newer, older), -1);
});

test("collapse waits out exit then shape, matching the CSS token pair", () => {
  assert.equal(MOTION_DURATION_MS.EXIT + MOTION_DURATION_MS.SHAPE, 550);
});
