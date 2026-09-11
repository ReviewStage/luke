import assert from "node:assert/strict";
import type { ObserveAnswer } from "@sidecar/hosted";
import { CLOUD_AGENT_PROVIDER_ID, SESSION_STATUS, SessionRoster } from "@sidecar/session";
import { test } from "vitest";
import { drawSnapshotRoster } from "./snapshot-roster.js";

const OBSERVED_AT = 1_800_000_000_000;

const OLDER = {
  providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
  sessionId: "chat-older",
  title: "Write the release notes",
  status: SESSION_STATUS.COMPLETE,
  lastActivityAt: OBSERVED_AT - 60_000,
};

const NEWER = {
  providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
  sessionId: "chat-newer",
  title: "Fix the roster test",
  status: SESSION_STATUS.WORKING,
  lastActivityAt: OBSERVED_AT,
};

function fixture(answers: readonly (ObserveAnswer | undefined)[]) {
  const registry = new SessionRoster();
  const reports: string[] = [];
  let call = 0;
  let current = true;
  const client = {
    observe: async () => {
      const answer = answers[call];
      call += 1;
      return answer;
    },
  };
  const draw = () =>
    drawSnapshotRoster({
      client,
      registry,
      isCurrent: () => current,
      report: (line) => reports.push(line),
    });
  const ids = () => registry.list().map((session) => session.providerSessionId);
  const stop = () => {
    current = false;
  };
  return { draw, ids, reports, registry, stop };
}

test("a pass replaces the provider's slice whole, newest activity first, and a session the next snapshot lacks leaves", async () => {
  const { draw, ids } = fixture([
    { sessions: [OLDER, NEWER], observedAt: OBSERVED_AT },
    { sessions: [NEWER], observedAt: OBSERVED_AT + 60_000 },
  ]);

  await draw();
  assert.deepEqual(ids(), [NEWER.sessionId, OLDER.sessionId]);

  await draw();
  assert.deepEqual(ids(), [NEWER.sessionId]);
});

test("a read that answers nothing leaves the last roster standing and says so", async () => {
  const { draw, ids, reports } = fixture([
    { sessions: [NEWER], observedAt: OBSERVED_AT },
    undefined,
  ]);

  await draw();
  await draw();
  assert.deepEqual(ids(), [NEWER.sessionId]);
  assert.equal(reports.length, 1);
});

test("a slice that cannot be drawn leaves the provider's previous sessions standing", async () => {
  const { draw, ids, reports } = fixture([
    { sessions: [NEWER], observedAt: OBSERVED_AT },
    { sessions: [OLDER, OLDER], observedAt: OBSERVED_AT },
  ]);

  await draw();
  await draw();
  assert.deepEqual(ids(), [NEWER.sessionId]);
  assert.equal(reports.length, 1);
});

test("a pass stopped while its read was out draws nothing", async () => {
  const { draw, ids, reports, stop } = fixture([{ sessions: [NEWER], observedAt: OBSERVED_AT }]);

  stop();
  await draw();
  assert.deepEqual(ids(), []);
  assert.equal(reports.length, 0);
});

test("the sessions drawn carry the provider's identity and the snapshot's advertisements", async () => {
  const { draw, registry } = fixture([
    {
      sessions: [{ ...NEWER, canReceiveMessage: true, link: "conductor://session/chat-newer" }],
      observedAt: OBSERVED_AT,
    },
  ]);

  await draw();
  const [session] = registry.list();
  assert.equal(session?.providerId, CLOUD_AGENT_PROVIDER_ID.CONDUCTOR);
  assert.deepEqual(session?.provider, {
    id: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
    displayName: "Conductor",
  });
  assert.equal(session?.detail.link, "conductor://session/chat-newer");
  assert.equal(session?.advertises.length, 1);
});
