import assert from "node:assert/strict";
import test from "node:test";
import {
  isRosterRelevant,
  type NormalizedSession,
  normalizeSession,
  rosterRelevantSessions,
  SESSION_STATUS,
  type SessionStatus,
  sessionRosterRetentionMs,
} from "../src";

const TEST_NOW = Date.parse("2026-08-16T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function session(
  providerSessionId: string,
  status: SessionStatus,
  observedAt: number,
): NormalizedSession {
  return normalizeSession(
    { id: "codex", displayName: "Codex" },
    { providerSessionId, title: "Implement the shared session core", status, observedAt },
  );
}

test("a session that is live or asking stays on the roster at any age", () => {
  for (const status of [SESSION_STATUS.WORKING, SESSION_STATUS.WAITING]) {
    assert.equal(
      isRosterRelevant(session("run:1", status, TEST_NOW - 100 * DAY_MS), TEST_NOW),
      true,
    );
  }
});

test("a failure stays through its rescue window and then leaves", () => {
  const retention = sessionRosterRetentionMs(SESSION_STATUS.ERROR);
  const atHorizon = session("run:1", SESSION_STATUS.ERROR, TEST_NOW - retention);
  const pastHorizon = session("run:2", SESSION_STATUS.ERROR, TEST_NOW - retention - 1);
  assert.equal(isRosterRelevant(atHorizon, TEST_NOW), true);
  assert.equal(isRosterRelevant(pastHorizon, TEST_NOW), false);
});

test("a settled or quiet session stays while its ending is news and then leaves", () => {
  for (const status of [SESSION_STATUS.COMPLETE, SESSION_STATUS.UNKNOWN]) {
    const retention = sessionRosterRetentionMs(status);
    assert.equal(isRosterRelevant(session("run:1", status, TEST_NOW - retention), TEST_NOW), true);
    assert.equal(
      isRosterRelevant(session("run:2", status, TEST_NOW - retention - 1), TEST_NOW),
      false,
    );
  }
});

test("filters a roster to the sessions still worth a row, keeping their order", () => {
  const workedForever = session("run:working", SESSION_STATUS.WORKING, TEST_NOW - 100 * DAY_MS);
  const finishedToday = session("run:finished-today", SESSION_STATUS.COMPLETE, TEST_NOW - 1_000);
  const finishedLongAgo = session(
    "run:finished-long-ago",
    SESSION_STATUS.COMPLETE,
    TEST_NOW - 100 * DAY_MS,
  );

  assert.deepEqual(
    rosterRelevantSessions([workedForever, finishedLongAgo, finishedToday], TEST_NOW),
    [workedForever, finishedToday],
  );
});
