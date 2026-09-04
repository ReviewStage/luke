import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSession,
  type ProviderSessionObservation,
  SESSION_COMPLETION_CAUSE,
  SESSION_NOTICE_STATUS,
  SESSION_STATUS,
  type Session,
  SessionNoticeTracker,
  type SessionProvider,
  type SessionStatus,
  sessionNoticeMemoryFromWire,
} from "@sidecar/session";
import { MAXIMUM_NOTICES_PER_PASS, SESSION_NOTICE_REPEAT_WINDOW_MS } from "./session-notices.js";

const claude: SessionProvider = { id: "claude-code", displayName: "Claude Code" };
const conductor: SessionProvider = { id: "conductor", displayName: "Conductor" };

function session(
  provider: SessionProvider,
  providerSessionId: string,
  status: SessionStatus,
  overrides: {
    activity?: string;
    error?: string;
    repository?: string;
    branch?: string;
    lastActivityAt?: number;
    workspace?: string;
    canReceiveMessage?: boolean;
    holdingForDeveloper?: boolean;
    realtimeVoiceLive?: boolean;
    completionCause?: (typeof SESSION_COMPLETION_CAUSE)[keyof typeof SESSION_COMPLETION_CAUSE];
  } = {},
): Session {
  const observation: ProviderSessionObservation = {
    providerSessionId,
    title: `Session ${providerSessionId}`,
    status,
    lastActivityAt: overrides.lastActivityAt ?? 100,
    detail: {},
  };
  if (overrides.completionCause) observation.completionCause = overrides.completionCause;
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
  if (overrides.activity || overrides.error || overrides.repository || overrides.branch) {
    const detail = observation.detail ?? {};
    if (overrides.activity) detail.activity = overrides.activity;
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
    lastActivityAt: 100,
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

test("the workspace and reply-ability ride a waiting notice", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices([session(conductor, "asks", SESSION_STATUS.WORKING)], 1_000);

  const notices = tracker.notices(
    [
      session(conductor, "asks", SESSION_STATUS.WAITING, {
        workspace: "Albany",
        canReceiveMessage: true,
      }),
    ],
    2_000,
  );

  assert.equal(notices[0]?.workspace, "Albany");
  assert.equal(notices[0]?.canReceiveMessage, true);
});

test("a waiting session whose adapter reported no hold claims no developer", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices([session(conductor, "idle", SESSION_STATUS.WORKING)], 1_000);

  // Conductor reports idle and nothing about why, so the notice is the
  // panel's to show and never a hold: only the adapter's own word makes one.
  const notices = tracker.notices(
    [
      session(conductor, "idle", SESSION_STATUS.WAITING, {
        canReceiveMessage: true,
      }),
    ],
    2_000,
  );

  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.status, SESSION_NOTICE_STATUS.WAITING);
  assert.equal(notices[0]?.holdingForDeveloper, false);
});

test("a permission hold is a waiting notice on the adapter's word", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices([session(claude, "held", SESSION_STATUS.WORKING)], 1_000);

  const notices = tracker.notices(
    [
      session(claude, "held", SESSION_STATUS.WAITING, {
        activity: "Bash: pnpm test",
        holdingForDeveloper: true,
      }),
    ],
    2_000,
  );

  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.status, SESSION_NOTICE_STATUS.WAITING);
  assert.equal(notices[0]?.activity, "Bash: pnpm test");
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
          lastActivityAt: 1_000 + SESSION_NOTICE_REPEAT_WINDOW_MS,
        }),
      ],
      1_000 + SESSION_NOTICE_REPEAT_WINDOW_MS,
    ).length,
    1,
  );
});

test("an edge is announced however old its timestamp, and only once", () => {
  const tracker = new SessionNoticeTracker();
  const slept = 4 * 60 * 60 * 1_000;
  tracker.notices([session(claude, "asleep", SESSION_STATUS.WORKING)], 1_000);

  // The Mac slept for hours and the session's file was last written two hours
  // ago. The timestamp says when the provider last wrote, not when the status
  // was entered, so it cannot tell late history from a finish that just landed:
  // the edge seen while watched is the news, and it speaks.
  const notices = tracker.notices(
    [
      session(claude, "asleep", SESSION_STATUS.COMPLETE, {
        lastActivityAt: 1_000 + slept - 2 * 60 * 60 * 1_000,
      }),
    ],
    1_000 + slept,
  );
  assert.deepEqual(
    notices.map((notice) => [notice.providerSessionId, notice.status]),
    [["asleep", SESSION_NOTICE_STATUS.COMPLETE]],
  );
  // The unchanged status is no edge, so the same finish never speaks again.
  assert.deepEqual(
    tracker.notices(
      [
        session(claude, "asleep", SESSION_STATUS.COMPLETE, {
          lastActivityAt: 1_000 + slept - 2 * 60 * 60 * 1_000,
        }),
      ],
      2_000 + slept,
    ),
    [],
  );
});

test("first sight of an old settled session is still not an edge", () => {
  const tracker = new SessionNoticeTracker();
  const now = 30 * 60 * 60 * 1_000;

  // A launch reads yesterday's roster: every session is seen for the first
  // time, so nothing is news, whatever its timestamp says.
  assert.deepEqual(
    tracker.notices(
      [
        session(claude, "yesterday", SESSION_STATUS.COMPLETE, {
          lastActivityAt: now - 20 * 60 * 60 * 1_000,
        }),
        session(claude, "earlier", SESSION_STATUS.WAITING, {
          lastActivityAt: now - 60 * 1_000,
        }),
      ],
      now,
    ),
    [],
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

test("a fresh tracker's snapshot is empty, and a pass fills it with status alone", () => {
  const tracker = new SessionNoticeTracker();
  assert.deepEqual(tracker.snapshot(), []);

  tracker.notices(
    [session(claude, "a", SESSION_STATUS.WORKING), session(conductor, "b", SESSION_STATUS.WAITING)],
    1_000,
  );

  assert.deepEqual(tracker.snapshot(), [
    { providerId: "claude-code", providerSessionId: "a", status: "working", noticedAt: [] },
    { providerId: "conductor", providerSessionId: "b", status: "waiting", noticedAt: [] },
  ]);
});

test("a snapshot records when each notice was spoken, and nothing a session said", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices([session(claude, "a", SESSION_STATUS.WORKING)], 1_000);
  tracker.notices(
    [session(claude, "a", SESSION_STATUS.WAITING, { activity: "Edit file", error: "boom" })],
    2_000,
  );

  assert.deepEqual(tracker.snapshot(), [
    {
      providerId: "claude-code",
      providerSessionId: "a",
      status: "waiting",
      noticedAt: [{ status: "waiting", at: 2_000 }],
    },
  ]);
});

test("a restored tracker diffs against the memory rather than seeding afresh", () => {
  const before = new SessionNoticeTracker();
  before.notices([session(claude, "a", SESSION_STATUS.WORKING)], 1_000);

  const after = SessionNoticeTracker.restore(before.snapshot());
  const notices = after.notices([session(claude, "a", SESSION_STATUS.COMPLETE)], 2_000);

  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.status, SESSION_NOTICE_STATUS.COMPLETE);
  assert.equal(notices[0]?.previousStatus, SESSION_STATUS.WORKING);
});

test("a restored tracker never replays a status the memory already held", () => {
  const before = new SessionNoticeTracker();
  before.notices([session(claude, "a", SESSION_STATUS.WAITING)], 1_000);

  const after = SessionNoticeTracker.restore(before.snapshot());
  assert.deepEqual(after.notices([session(claude, "a", SESSION_STATUS.WAITING)], 2_000), []);
});

test("the repeat window survives a restore", () => {
  const before = new SessionNoticeTracker();
  before.notices([session(claude, "a", SESSION_STATUS.WORKING)], 1_000);
  assert.equal(before.notices([session(claude, "a", SESSION_STATUS.ERROR)], 2_000).length, 1);

  const after = SessionNoticeTracker.restore(before.snapshot());
  const inside = 2_000 + SESSION_NOTICE_REPEAT_WINDOW_MS - 1;
  after.notices([session(claude, "a", SESSION_STATUS.WORKING)], inside);
  assert.deepEqual(after.notices([session(claude, "a", SESSION_STATUS.ERROR)], inside), []);

  const outside = 2_000 + SESSION_NOTICE_REPEAT_WINDOW_MS;
  after.notices([session(claude, "a", SESSION_STATUS.WORKING)], outside);
  assert.equal(after.notices([session(claude, "a", SESSION_STATUS.ERROR)], outside).length, 1);
});

test("a memory round-trips through JSON and the wire reader unchanged", () => {
  const tracker = new SessionNoticeTracker();
  tracker.notices(
    [session(claude, "a", SESSION_STATUS.WORKING), session(conductor, "a", SESSION_STATUS.WORKING)],
    1_000,
  );
  tracker.notices(
    [session(claude, "a", SESSION_STATUS.ERROR), session(conductor, "a", SESSION_STATUS.WAITING)],
    2_000,
  );

  const memory = tracker.snapshot();
  const restored = sessionNoticeMemoryFromWire(JSON.parse(JSON.stringify(memory)));
  assert.deepEqual(restored, memory);
  assert.deepEqual(SessionNoticeTracker.restore(restored).snapshot(), memory);
});

test("the wire reader drops what it cannot place and keeps the rest", () => {
  const memory = sessionNoticeMemoryFromWire([
    { providerId: "claude-code", providerSessionId: "a", status: "working", noticedAt: [] },
    { providerId: "claude-code", providerSessionId: "b", status: "paused", noticedAt: [] },
    { providerId: "claude-code", providerSessionId: 3, status: "working", noticedAt: [] },
    { providerId: "", providerSessionId: "d", status: "working", noticedAt: [] },
    "not a record",
    {
      providerId: "conductor",
      providerSessionId: "e",
      status: "error",
      noticedAt: [
        { status: "error", at: 5_000 },
        { status: "working", at: 1 },
        { status: "waiting", at: "soon" },
        { status: "complete", at: Number.NaN },
        "later",
      ],
    },
    { providerId: "conductor", providerSessionId: "f", status: "complete", noticedAt: "never" },
  ]);

  assert.deepEqual(memory, [
    { providerId: "claude-code", providerSessionId: "a", status: "working", noticedAt: [] },
    {
      providerId: "conductor",
      providerSessionId: "e",
      status: "error",
      noticedAt: [{ status: "error", at: 5_000 }],
    },
    { providerId: "conductor", providerSessionId: "f", status: "complete", noticedAt: [] },
  ]);
  assert.deepEqual(sessionNoticeMemoryFromWire({ providerId: "claude-code" }), []);
  assert.deepEqual(sessionNoticeMemoryFromWire(undefined), []);
});

test("a memory naming one session twice keeps the later record", () => {
  const tracker = SessionNoticeTracker.restore([
    {
      providerId: "claude-code",
      providerSessionId: "a",
      status: SESSION_STATUS.WORKING,
      noticedAt: [],
    },
    {
      providerId: "claude-code",
      providerSessionId: "a",
      status: SESSION_STATUS.WAITING,
      noticedAt: [],
    },
  ]);

  assert.deepEqual(tracker.notices([session(claude, "a", SESSION_STATUS.WAITING)], 2_000), []);
});
