import assert from "node:assert/strict";
import test from "node:test";
import {
  isRosterRelevant,
  type NormalizedSession,
  normalizeSession,
  rosterRelevantSessions,
  SESSION_STATUS,
  type SessionStatus,
  sessionChangeNumber,
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

test("reads the pull request's number off every host's address shape", () => {
  assert.equal(sessionChangeNumber("https://github.com/reviewstage/luke/pull/245"), 245);
  assert.equal(
    sessionChangeNumber("https://gitlab.com/reviewstage/group/sidecar-web/-/merge_requests/3"),
    3,
  );
  assert.equal(
    sessionChangeNumber("https://bitbucket.org/reviewstage/sidecar-native/pull-requests/9"),
    9,
  );
});

test("an address whose tail names no number yields none rather than a guess", () => {
  assert.equal(sessionChangeNumber("https://github.com/reviewstage/luke/pulls"), undefined);
  assert.equal(
    sessionChangeNumber("https://github.com/reviewstage/luke/pull/245/files"),
    undefined,
  );
  assert.equal(sessionChangeNumber("not an address"), undefined);
});

test("keeps a sound diff summary and drops a suspect or empty one whole", () => {
  const withDiff = (diff: Parameters<typeof normalizeSession>[1]["detail"]) =>
    normalizeSession(
      { id: "codex", displayName: "Codex" },
      {
        providerSessionId: "task-1",
        title: "workspace",
        status: SESSION_STATUS.COMPLETE,
        observedAt: TEST_NOW,
        detail: diff,
      },
    ).detail.diff;

  assert.deepEqual(withDiff({ diff: { filesChanged: 3, linesAdded: 12, linesRemoved: 4 } }), {
    filesChanged: 3,
    linesAdded: 12,
    linesRemoved: 4,
  });
  // A summary of nothing says nothing a row should spend words on.
  assert.equal(withDiff({ diff: { filesChanged: 0, linesAdded: 0, linesRemoved: 0 } }), undefined);
  // One count outside sense makes the others suspect, so the summary drops whole.
  assert.equal(
    withDiff({ diff: { filesChanged: -1, linesAdded: 12, linesRemoved: 4 } }),
    undefined,
  );
  assert.equal(
    withDiff({ diff: { filesChanged: 3, linesAdded: 12.5, linesRemoved: 4 } }),
    undefined,
  );
  assert.equal(
    withDiff({ diff: { filesChanged: 3, linesAdded: 12, linesRemoved: 1_000_000 } }),
    undefined,
  );
});

test("keeps the agent behind a hosted session, and drops one saying nothing", () => {
  const withAgent = (agent: Parameters<typeof normalizeSession>[1]["agent"]) =>
    normalizeSession(
      { id: "conductor", displayName: "Conductor" },
      {
        providerSessionId: "chat-1",
        title: "Hosted chat",
        status: SESSION_STATUS.WORKING,
        observedAt: TEST_NOW,
        agent,
      },
    ).agent;

  assert.deepEqual(withAgent({ id: "claude-code", displayName: "Claude Code" }), {
    id: "claude-code",
    displayName: "Claude Code",
  });
  // An empty display name falls back to the id rather than to a blank mark.
  assert.deepEqual(withAgent({ id: "codex", displayName: "  " }), {
    id: "codex",
    displayName: "codex",
  });
  // An agent naming the provider itself says nothing the provider id does not.
  assert.equal(withAgent({ id: "conductor", displayName: "Conductor" }), undefined);
  assert.equal(withAgent({ id: "   ", displayName: "Claude Code" }), undefined);
  assert.equal(withAgent(undefined), undefined);
});
