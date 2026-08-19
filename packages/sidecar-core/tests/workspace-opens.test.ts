import assert from "node:assert/strict";
import test from "node:test";
import {
  CREATED_WORKSPACE_OPEN_WINDOW_MS,
  CreatedWorkspaceOpenTracker,
  type NormalizedSession,
  normalizeSession,
  SESSION_STATUS,
  type SessionProvider,
} from "../src";

const conductor: SessionProvider = { id: "conductor", displayName: "Conductor" };
const cursor: SessionProvider = { id: "cursor", displayName: "Cursor" };
const CONDUCTOR_LINK = "conductor://workspaces/workspace-new";

function session(
  provider: SessionProvider,
  providerSessionId: string,
  link?: string,
): NormalizedSession {
  return normalizeSession(provider, {
    providerSessionId,
    title: `Session ${providerSessionId}`,
    status: SESSION_STATUS.WORKING,
    observedAt: 100,
    detail: link ? { link } : {},
  });
}

test("claims an expected session exactly once, and only once it has an address", () => {
  const tracker = new CreatedWorkspaceOpenTracker();
  tracker.expect({ providerId: conductor.id, providerSessionId: "session-new" }, 1_000);

  // A pass that has not seen the session yet resolves nothing.
  assert.deepEqual(tracker.claim([session(conductor, "session-old", CONDUCTOR_LINK)], 2_000), []);

  // Listed but not yet addressed keeps waiting: providers can report a session
  // before its deep link exists.
  assert.deepEqual(tracker.claim([session(conductor, "session-new")], 3_000), []);

  const claimed = tracker.claim([session(conductor, "session-new", CONDUCTOR_LINK)], 4_000);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]?.providerSessionId, "session-new");
  assert.equal(claimed[0]?.detail.link, CONDUCTOR_LINK);

  // Claimed is claimed: the same commit arriving again opens nothing twice.
  assert.deepEqual(tracker.claim([session(conductor, "session-new", CONDUCTOR_LINK)], 5_000), []);
});

test("an identity is claimed only under its own provider", () => {
  const tracker = new CreatedWorkspaceOpenTracker();
  tracker.expect({ providerId: conductor.id, providerSessionId: "session-new" }, 1_000);

  // Another provider reporting the same id is a different session entirely.
  assert.deepEqual(tracker.claim([session(cursor, "session-new", CONDUCTOR_LINK)], 2_000), []);

  const claimed = tracker.claim(
    [
      session(cursor, "session-new", CONDUCTOR_LINK),
      session(conductor, "session-new", CONDUCTOR_LINK),
    ],
    3_000,
  );
  assert.deepEqual(
    claimed.map((entry) => entry.providerId),
    [conductor.id],
  );
});

test("an entry lapses past its window, whether or not its session ever appeared", () => {
  const tracker = new CreatedWorkspaceOpenTracker();
  tracker.expect({ providerId: conductor.id, providerSessionId: "session-new" }, 1_000);

  // At the deadline the entry still stands; one tick past it, it is gone.
  const atDeadline = 1_000 + CREATED_WORKSPACE_OPEN_WINDOW_MS;
  assert.deepEqual(tracker.claim([session(conductor, "session-other")], atDeadline), []);
  const late = tracker.claim([session(conductor, "session-new", CONDUCTOR_LINK)], atDeadline + 1);
  assert.deepEqual(late, []);

  // And it stays gone: the lapse is a drop, not a deferral.
  assert.deepEqual(
    tracker.claim([session(conductor, "session-new", CONDUCTOR_LINK)], atDeadline + 2),
    [],
  );
});

test("a repeated creation refreshes the same entry rather than stacking a second", () => {
  const tracker = new CreatedWorkspaceOpenTracker();
  tracker.expect({ providerId: conductor.id, providerSessionId: "session-new" }, 1_000);
  tracker.expect({ providerId: conductor.id, providerSessionId: "session-new" }, 2_000);

  const claimed = tracker.claim([session(conductor, "session-new", CONDUCTOR_LINK)], 3_000);
  assert.equal(claimed.length, 1);
  assert.deepEqual(tracker.claim([session(conductor, "session-new", CONDUCTOR_LINK)], 4_000), []);
});

test("several created sessions resolve independently as their passes land", () => {
  const tracker = new CreatedWorkspaceOpenTracker();
  tracker.expect({ providerId: conductor.id, providerSessionId: "session-a" }, 1_000);
  tracker.expect({ providerId: cursor.id, providerSessionId: "bc-agent" }, 1_000);

  const first = tracker.claim([session(conductor, "session-a", CONDUCTOR_LINK)], 2_000);
  assert.deepEqual(
    first.map((entry) => entry.providerSessionId),
    ["session-a"],
  );

  const second = tracker.claim(
    [session(cursor, "bc-agent", "https://cursor.com/agents?id=bc-agent")],
    3_000,
  );
  assert.deepEqual(
    second.map((entry) => entry.providerSessionId),
    ["bc-agent"],
  );
});
