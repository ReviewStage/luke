import assert from "node:assert/strict";
import test from "node:test";
import {
  type NormalizedSession,
  normalizeSession,
  type ProviderSessionObservation,
  SESSION_COMPLETION_CAUSE,
  SESSION_NOTICE_STATUS,
  SESSION_STATUS,
  SessionNoticeTracker,
  type SessionProvider,
  type SessionStatus,
} from "@sidecar/session";
import {
  MAXIMUM_NOTICES_PER_PASS,
  SESSION_NOTICE_FRESH_AGE_MS,
  SESSION_NOTICE_REPEAT_WINDOW_MS,
} from "./session-notices.js";

const claude: SessionProvider = { id: "claude-code", displayName: "Claude Code" };
const conductor: SessionProvider = { id: "conductor", displayName: "Conductor" };

function session(
  provider: SessionProvider,
  providerSessionId: string,
  status: SessionStatus,
  overrides: {
    error?: string;
    repository?: string;
    branch?: string;
    observedAt?: number;
    recap?: string;
    workspace?: string;
    canReceiveMessage?: boolean;
    holdingForDeveloper?: boolean;
    realtimeVoiceLive?: boolean;
    completionCause?: (typeof SESSION_COMPLETION_CAUSE)[keyof typeof SESSION_COMPLETION_CAUSE];
  } = {},
): NormalizedSession {
  const observation: ProviderSessionObservation = {
    providerSessionId,
    title: `Session ${providerSessionId}`,
    status,
    observedAt: overrides.observedAt ?? 100,
    detail: {},
  };
  if (overrides.completionCause) observation.completionCause = overrides.completionCause;
  if (overrides.recap) observation.recap = overrides.recap;
  if (overrides.workspace) {
    observation.workspace = { providerWorkspaceId: "ws-1", name: overrides.workspace };
  }
  if (overrides.canReceiveMessage !== undefined) {
    observation.canReceiveMessage = overrides.canReceiveMessage;
  }
  if (overrides.holdingForDeveloper !== undefined) {
    observation.holdingForDeveloper = overrides.holdingForDeveloper;
  }
  if (overrides.realtimeVoiceLive !== undefined) {
    observation.realtimeVoiceLive = overrides.realtimeVoiceLive;
  }
  if (overrides.error || overrides.repository || overrides.branch) {
    const detail = observation.detail ?? {};
    if (overrides.error) detail.error = overrides.error;
    if (overrides.repository) detail.repository = overrides.repository;
    if (overrides.branch) detail.branch = overrides.branch;
    observation.detail = detail;
  }
  return normalizeSession(provider, observation);
}

test("a session under a live voice conversation announces nothing while it holds", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices(
    [session(claude, "spoken", SESSION_STATUS.WORKING, { realtimeVoiceLive: true })],
    1_000,
  );

  // Each delegated turn settling would otherwise be a waiting banner, and a
  // failed one an error banner, spoken over the very conversation they belong to.
  assert.deepEqual(
    tracker.notices(
      [session(claude, "spoken", SESSION_STATUS.WAITING, { realtimeVoiceLive: true })],
      2_000,
    ),
    [],
  );
  assert.deepEqual(
    tracker.notices(
      [
        session(claude, "spoken", SESSION_STATUS.ERROR, {
          realtimeVoiceLive: true,
          error: "sandbox denied",
        }),
      ],
      3_000,
    ),
    [],
  );
});

test("the voice conversation ending never replays the edges it covered", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices(
    [session(claude, "spoken", SESSION_STATUS.WORKING, { realtimeVoiceLive: true })],
    1_000,
  );
  tracker.notices(
    [session(claude, "spoken", SESSION_STATUS.WAITING, { realtimeVoiceLive: true })],
    2_000,
  );

  // The conversation closed with the session still waiting: nothing moved, so
  // there is no news to read out after the fact.
  assert.deepEqual(tracker.notices([session(claude, "spoken", SESSION_STATUS.WAITING)], 3_000), []);

  // A fresh edge after the conversation speaks like any other session's.
  tracker.notices([session(claude, "spoken", SESSION_STATUS.WORKING)], 4_000);
  const notices = tracker.notices([session(claude, "spoken", SESSION_STATUS.COMPLETE)], 5_000);
  assert.deepEqual(
    notices.map((notice) => [notice.providerSessionId, notice.status]),
    [["spoken", SESSION_NOTICE_STATUS.COMPLETE]],
  );
});

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
    canReceiveMessage: false,
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
      session(claude, "waits", SESSION_STATUS.WAITING, { holdingForDeveloper: true }),
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

test("closing a session is tracked as complete without producing a notice", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices([session(claude, "closed", SESSION_STATUS.WAITING)], 1_000);

  assert.deepEqual(
    tracker.notices(
      [
        session(claude, "closed", SESSION_STATUS.COMPLETE, {
          completionCause: SESSION_COMPLETION_CAUSE.SESSION_CLOSED,
        }),
      ],
      2_000,
    ),
    [],
  );
  assert.deepEqual(
    tracker.notices(
      [
        session(claude, "closed", SESSION_STATUS.COMPLETE, {
          completionCause: SESSION_COMPLETION_CAUSE.SESSION_CLOSED,
        }),
      ],
      3_000,
    ),
    [],
  );
});

test("finishing work still produces a completion notice", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices([session(claude, "finished", SESSION_STATUS.WORKING)], 1_000);

  const notices = tracker.notices(
    [
      session(claude, "finished", SESSION_STATUS.COMPLETE, {
        completionCause: SESSION_COMPLETION_CAUSE.WORK_FINISHED,
      }),
    ],
    2_000,
  );

  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.status, SESSION_NOTICE_STATUS.COMPLETE);
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

test("the recap, workspace, and reply-ability ride a waiting notice", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices([session(conductor, "asks", SESSION_STATUS.WORKING)], 1_000);

  // The agent's parting words at the edge are usually the question the
  // session is now waiting on — the whole reason the notice is worth hearing.
  const notices = tracker.notices(
    [
      session(conductor, "asks", SESSION_STATUS.WAITING, {
        recap: "Should sessions expire after 24 hours?",
        workspace: "Albany",
        canReceiveMessage: true,
      }),
    ],
    2_000,
  );

  assert.equal(notices[0]?.recap, "Should sessions expire after 24 hours?");
  assert.equal(notices[0]?.workspace, "Albany");
  assert.equal(notices[0]?.canReceiveMessage, true);
});

test("a waiting turn that does not need the developer produces no notice", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices([session(conductor, "idle", SESSION_STATUS.WORKING)], 1_000);

  // Conductor idle is waiting on the row — the turn ended — but the parting
  // words do not ask anything, so reading them out as "waiting on you" would
  // be a false ask.
  assert.deepEqual(
    tracker.notices(
      [
        session(conductor, "idle", SESSION_STATUS.WAITING, {
          recap: "The notch panel now follows the menu bar depth.",
          canReceiveMessage: true,
        }),
      ],
      2_000,
    ),
    [],
  );
});

test("a waiting recap that only has a URL query string is not an ask", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices([session(conductor, "link", SESSION_STATUS.WORKING)], 1_000);

  assert.deepEqual(
    tracker.notices(
      [
        session(conductor, "link", SESSION_STATUS.WAITING, {
          recap: "Opened https://github.com/review/luke/pull/12?w=1 for the panel follow.",
        }),
      ],
      2_000,
    ),
    [],
  );
});

test("a question that ends on a URL is still an ask", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices([session(conductor, "ask", SESSION_STATUS.WORKING)], 1_000);

  const notices = tracker.notices(
    [
      session(conductor, "ask", SESSION_STATUS.WAITING, {
        recap: "Should I open https://github.com/review/luke/pull/12?",
      }),
    ],
    2_000,
  );

  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.status, SESSION_NOTICE_STATUS.WAITING);
});

test("a permission hold is a waiting notice even without a question in the recap", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices([session(claude, "held", SESSION_STATUS.WORKING)], 1_000);

  const notices = tracker.notices(
    [
      session(claude, "held", SESSION_STATUS.WAITING, {
        recap: "Editing the shared session core.",
        holdingForDeveloper: true,
      }),
    ],
    2_000,
  );

  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.status, SESSION_NOTICE_STATUS.WAITING);
});

test("a flapping status is noticed once per repeat window, then again after it", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices([session(claude, "flap", SESSION_STATUS.WORKING)], 0);

  assert.equal(
    tracker.notices(
      [session(claude, "flap", SESSION_STATUS.WAITING, { holdingForDeveloper: true })],
      1_000,
    ).length,
    1,
  );
  tracker.notices([session(claude, "flap", SESSION_STATUS.WORKING)], 2_000);
  // The same edge inside the window stays quiet.
  assert.equal(
    tracker.notices(
      [session(claude, "flap", SESSION_STATUS.WAITING, { holdingForDeveloper: true })],
      3_000,
    ).length,
    0,
  );
  tracker.notices([session(claude, "flap", SESSION_STATUS.WORKING)], 4_000);
  // A different status is its own ledger entry.
  assert.equal(tracker.notices([session(claude, "flap", SESSION_STATUS.ERROR)], 5_000).length, 1);
  tracker.notices([session(claude, "flap", SESSION_STATUS.WORKING)], 6_000);
  // And past the window the same status may speak again — the ask is fresh,
  // not a stale reading resurfacing.
  assert.equal(
    tracker.notices(
      [
        session(claude, "flap", SESSION_STATUS.WAITING, {
          holdingForDeveloper: true,
          observedAt: 1_000 + SESSION_NOTICE_REPEAT_WINDOW_MS,
        }),
      ],
      1_000 + SESSION_NOTICE_REPEAT_WINDOW_MS,
    ).length,
    1,
  );
});

test("an edge whose event is old is tracked but never announced", () => {
  const tracker = new SessionNoticeTracker();
  const slept = 4 * 60 * 60 * 1_000;
  tracker.notices([session(claude, "asleep", SESSION_STATUS.WORKING)], 1_000);

  // The Mac slept for hours; the session finished minutes into the nap. The
  // edge only becomes visible on the first pass after waking, but the event
  // it describes is old news the panel has shown the whole time.
  assert.deepEqual(
    tracker.notices(
      [session(claude, "asleep", SESSION_STATUS.COMPLETE, { observedAt: 10 * 60 * 1_000 })],
      1_000 + slept,
    ),
    [],
  );
  // The suppressed edge was still recorded: the unchanged status is no edge,
  // so the stale event does not resurface on a later pass either.
  assert.deepEqual(
    tracker.notices(
      [session(claude, "asleep", SESSION_STATUS.COMPLETE, { observedAt: 10 * 60 * 1_000 })],
      2_000 + slept,
    ),
    [],
  );
});

test("a stale edge stays quiet while a fresh one in the same pass announces", () => {
  const tracker = new SessionNoticeTracker();
  const now = SESSION_NOTICE_FRESH_AGE_MS * 10;
  tracker.notices(
    [
      session(claude, "stale", SESSION_STATUS.WORKING),
      session(claude, "fresh", SESSION_STATUS.WORKING),
    ],
    1_000,
  );

  const notices = tracker.notices(
    [
      session(claude, "stale", SESSION_STATUS.COMPLETE, {
        observedAt: now - SESSION_NOTICE_FRESH_AGE_MS - 1,
      }),
      session(claude, "fresh", SESSION_STATUS.COMPLETE, {
        observedAt: now - SESSION_NOTICE_FRESH_AGE_MS,
      }),
    ],
    now,
  );

  assert.deepEqual(
    notices.map((notice) => [notice.providerSessionId, notice.status]),
    [["fresh", SESSION_NOTICE_STATUS.COMPLETE]],
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
