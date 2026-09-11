import assert from "node:assert/strict";
import {
  isRosterRelevant,
  normalizeSession,
  rosterRelevantSessions,
  SESSION_STATUS,
  type Session,
  type SessionStatus,
  sessionRosterRetentionMs,
} from "@sidecar/session";
import { test } from "vitest";

const TEST_NOW = Date.parse("2026-09-09T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function session(
  providerSessionId: string,
  status: SessionStatus,
  lastActivityAt: number,
): Session {
  return normalizeSession(
    { id: "codex", displayName: "Codex" },
    { providerSessionId, title: "Implement the shared session core", status, lastActivityAt },
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

test("a standing row never ages out, however old its own timestamp", () => {
  const standing = normalizeSession(
    { id: "superset", displayName: "Superset" },
    {
      providerSessionId: "workspace-1",
      title: "power-vacation",
      status: SESSION_STATUS.COMPLETE,
      lastActivityAt: TEST_NOW - 100 * DAY_MS,
      standing: true,
    },
  );
  // Its provider re-reports it while it exists and drops it when it is gone,
  // so retention has nothing to age out — unlike the settled chat beside it.
  assert.equal(standing.standing, true);
  assert.equal(isRosterRelevant(standing, TEST_NOW), true);
  assert.equal(
    isRosterRelevant(session("run:1", SESSION_STATUS.COMPLETE, TEST_NOW - 100 * DAY_MS), TEST_NOW),
    false,
  );
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
