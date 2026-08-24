import assert from "node:assert/strict";
import test from "node:test";
import { ATTENTION_DISPOSITION, normalizeSession, SESSION_STATUS } from "@sidecar/session";
import type { SessionRosterPayload } from "#shared/wire/session";
import { staleBootstrap } from "./use-bootstrap-raced-channel";

test("a live push makes the bootstrap snapshot stale", () => {
  assert.equal(
    staleBootstrap(false),
    false,
    "nothing has arrived; the snapshot is still the newest word",
  );
  assert.equal(
    staleBootstrap(true),
    true,
    "a push that raced past the reply must not be clobbered by it",
  );
});

test("a newer roster push cannot be partially overwritten by an older bootstrap", () => {
  const session = normalizeSession(
    { id: "codex", displayName: "Codex" },
    {
      providerSessionId: "task-1",
      title: "Repair session consolidation",
      status: SESSION_STATUS.WORKING,
      observedAt: 2,
    },
  );
  const older: SessionRosterPayload = { sessions: [], attention: [] };
  const newer: SessionRosterPayload = {
    sessions: [session],
    attention: [
      {
        providerId: "codex",
        providerSessionId: "task-1",
        decision: { disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN, decidedAt: 2 },
      },
    ],
  };
  let current: SessionRosterPayload = older;
  let pushed = false;

  pushed = true;
  current = newer;
  if (!staleBootstrap(pushed)) current = older;

  assert.equal(current, newer);
  assert.equal(current.sessions[0]?.providerSessionId, "task-1");
  assert.equal(current.attention[0]?.providerSessionId, "task-1");
});
