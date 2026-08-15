import assert from "node:assert/strict";
import test from "node:test";
import {
  type NormalizedSession,
  normalizeSession,
  SESSION_NOTICE_STATUS,
  SESSION_STATUS,
  SessionNoticeTracker,
  type SessionProvider,
  type SessionStatus,
} from "../src";
import { MAXIMUM_NOTICES_PER_PASS, SESSION_NOTICE_REPEAT_WINDOW_MS } from "../src/session-notices";

const claude: SessionProvider = { id: "claude-code", displayName: "Claude Code" };
const conductor: SessionProvider = { id: "conductor", displayName: "Conductor" };

function session(
  provider: SessionProvider,
  providerSessionId: string,
  status: SessionStatus,
  overrides: { error?: string; repository?: string; branch?: string; observedAt?: number } = {},
): NormalizedSession {
  return normalizeSession(provider, {
    providerSessionId,
    title: `Session ${providerSessionId}`,
    status,
    observedAt: overrides.observedAt ?? 100,
    detail: {
      ...(overrides.error ? { error: overrides.error } : {}),
      ...(overrides.repository ? { repository: overrides.repository } : {}),
      ...(overrides.branch ? { branch: overrides.branch } : {}),
    },
  });
}

test("first sight seeds silently, and only a change of status is news", () => {
  const tracker = new SessionNoticeTracker();

  // A session already waiting at launch is the panel's to show, not a banner's.
  assert.deepEqual(tracker.notices([session(claude, "a", SESSION_STATUS.WAITING)], 1_000), []);
  // Nothing moved, nothing said.
  assert.deepEqual(tracker.notices([session(claude, "a", SESSION_STATUS.WAITING)], 2_000), []);

  const notices = tracker.notices([session(claude, "a", SESSION_STATUS.COMPLETE)], 3_000);
  assert.equal(notices.length, 1);
  assert.deepEqual(notices[0], {
    providerId: claude.id,
    providerSessionId: "a",
    providerName: claude.displayName,
    title: "Session a",
    status: SESSION_NOTICE_STATUS.COMPLETE,
    previousStatus: SESSION_STATUS.WAITING,
    observedAt: 100,
  });
});

test("every notice-worthy arrival is one, and the quiet statuses are not", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices(
    [
      session(claude, "waits", SESSION_STATUS.WORKING),
      session(claude, "stops", SESSION_STATUS.WORKING),
      session(claude, "finishes", SESSION_STATUS.WORKING),
      session(claude, "fades", SESSION_STATUS.WORKING),
    ],
    1_000,
  );

  const notices = tracker.notices(
    [
      session(claude, "waits", SESSION_STATUS.WAITING),
      session(claude, "stops", SESSION_STATUS.ERROR, { error: "API rate limit" }),
      session(claude, "finishes", SESSION_STATUS.COMPLETE),
      // An adapter losing sight of a session is not the session asking for a hand.
      session(claude, "fades", SESSION_STATUS.UNKNOWN),
    ],
    2_000,
  );

  assert.deepEqual(
    notices.map((notice) => [notice.providerSessionId, notice.status]),
    [
      ["waits", SESSION_NOTICE_STATUS.WAITING],
      ["stops", SESSION_NOTICE_STATUS.ERROR],
      ["finishes", SESSION_NOTICE_STATUS.COMPLETE],
    ],
  );
  assert.equal(notices[1]?.error, "API rate limit");
});

test("the provider's own context rides the notice", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices([session(conductor, "ctx", SESSION_STATUS.WORKING)], 1_000);

  const notices = tracker.notices(
    [session(conductor, "ctx", SESSION_STATUS.COMPLETE, { repository: "luke", branch: "algiers" })],
    2_000,
  );

  assert.equal(notices[0]?.repository, "luke");
  assert.equal(notices[0]?.branch, "algiers");
});

test("a flapping status is noticed once per repeat window, then again after it", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices([session(claude, "flap", SESSION_STATUS.WORKING)], 0);

  assert.equal(tracker.notices([session(claude, "flap", SESSION_STATUS.WAITING)], 1_000).length, 1);
  tracker.notices([session(claude, "flap", SESSION_STATUS.WORKING)], 2_000);
  // The same edge inside the window stays quiet.
  assert.equal(tracker.notices([session(claude, "flap", SESSION_STATUS.WAITING)], 3_000).length, 0);
  tracker.notices([session(claude, "flap", SESSION_STATUS.WORKING)], 4_000);
  // A different status is its own ledger entry.
  assert.equal(tracker.notices([session(claude, "flap", SESSION_STATUS.ERROR)], 5_000).length, 1);
  tracker.notices([session(claude, "flap", SESSION_STATUS.WORKING)], 6_000);
  // And past the window the same status may speak again.
  assert.equal(
    tracker.notices(
      [session(claude, "flap", SESSION_STATUS.WAITING)],
      1_000 + SESSION_NOTICE_REPEAT_WINDOW_MS,
    ).length,
    1,
  );
});

test("a session that leaves the roster is forgotten, and its return seeds again", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices([session(claude, "gone", SESSION_STATUS.WORKING)], 1_000);
  tracker.notices([], 2_000);

  // Returning already complete is a first sight, not an edge.
  assert.deepEqual(tracker.notices([session(claude, "gone", SESSION_STATUS.COMPLETE)], 3_000), []);
});

test("two providers' identical session ids never collide", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices(
    [
      session(claude, "same", SESSION_STATUS.WORKING),
      session(conductor, "same", SESSION_STATUS.WAITING),
    ],
    1_000,
  );

  const notices = tracker.notices(
    [
      session(claude, "same", SESSION_STATUS.COMPLETE),
      session(conductor, "same", SESSION_STATUS.WAITING),
    ],
    2_000,
  );

  assert.deepEqual(
    notices.map((notice) => [notice.providerId, notice.status]),
    [[claude.id, SESSION_NOTICE_STATUS.COMPLETE]],
  );
});

test("a burst is trimmed to the cap with the most urgent notices kept", () => {
  const tracker = new SessionNoticeTracker();
  const count = MAXIMUM_NOTICES_PER_PASS + 3;
  const ids = Array.from({ length: count }, (_, index) => `burst-${index}`);
  tracker.notices(
    ids.map((id) => session(claude, id, SESSION_STATUS.WORKING)),
    1_000,
  );

  // The completions come first in roster order, so a naive cut would keep
  // finishes and drop the one session that stopped on an error.
  const notices = tracker.notices(
    ids.map((id, index) =>
      session(claude, id, index === count - 1 ? SESSION_STATUS.ERROR : SESSION_STATUS.COMPLETE),
    ),
    2_000,
  );

  assert.equal(notices.length, MAXIMUM_NOTICES_PER_PASS);
  assert.equal(notices[0]?.status, SESSION_NOTICE_STATUS.ERROR);
  // The remaining slots keep the earliest completions in their own order.
  assert.deepEqual(
    notices.slice(1).map((notice) => notice.providerSessionId),
    ids.slice(0, MAXIMUM_NOTICES_PER_PASS - 1),
  );
});
