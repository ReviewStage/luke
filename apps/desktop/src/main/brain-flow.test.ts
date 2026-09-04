import assert from "node:assert/strict";
import test from "node:test";
import { BRAIN_STATE_VERSION, BRAIN_WAKE_HOOK, BRAIN_WAKE_KIND } from "@sidecar/brain";
import { HOOK_EVENT } from "@sidecar/providers";
import { normalizeSession, SESSION_STATUS, type Session } from "@sidecar/session";
import { brainStateFromStored, brainStateRecord, wakeEventsFromHooks } from "./brain-flow";

const NOW = 1_800_000_000_000;

test("the brain's state round-trips through its file, and anything else reads as nothing", () => {
  const state = {
    version: BRAIN_STATE_VERSION,
    items: [{ type: "message", role: "user", content: [] }],
    cursors: { "claude-code": { "session-a": "1024" } },
  } as const;

  assert.deepEqual(brainStateFromStored(brainStateRecord(state)), state);
  assert.equal(brainStateFromStored(undefined), undefined);
  assert.equal(brainStateFromStored("not json"), undefined);
  assert.equal(
    brainStateFromStored(JSON.stringify({ version: 99, items: [], cursors: {} })),
    undefined,
  );
  assert.equal(
    brainStateFromStored(JSON.stringify({ version: 1, items: "x", cursors: {} })),
    undefined,
  );
});

test("every hook event wakes the brain, carrying the session when the roster holds it", () => {
  const held = normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId: "session-a",
      title: "Fix the flaky test",
      status: SESSION_STATUS.COMPLETE,
      lastActivityAt: NOW - 1_000,
    },
  );
  const registry = {
    get: (identity: { providerSessionId: string }): Session | undefined =>
      identity.providerSessionId === "session-a" ? held : undefined,
  };

  const wakes = wakeEventsFromHooks(
    "claude-code",
    [
      { providerSessionId: "session-a", event: "stop", atMs: NOW - 500 },
      { providerSessionId: "session-b", event: "prompt", atMs: Number.NaN },
    ],
    registry,
    NOW,
  );

  assert.equal(wakes.length, 2);
  assert.deepEqual(wakes[0], {
    kind: BRAIN_WAKE_KIND.HOOK,
    identity: { providerId: "claude-code", providerSessionId: "session-a" },
    hookEvent: "stop",
    session: held,
    atMs: NOW - 500,
  });
  // A hook for a session the poll has not seen yet still wakes the brain,
  // dated now when the spool carried no usable time.
  assert.deepEqual(wakes[1], {
    kind: BRAIN_WAKE_KIND.HOOK,
    identity: { providerId: "claude-code", providerSessionId: "session-b" },
    hookEvent: "prompt",
    atMs: NOW,
  });
});

test("the hook tokens the fallback digest reads are the ones the spool writes", () => {
  assert.equal(BRAIN_WAKE_HOOK.STOP_FAILURE, HOOK_EVENT.STOP_FAILURE);
  assert.equal(BRAIN_WAKE_HOOK.NOTIFICATION, HOOK_EVENT.NOTIFICATION);
  assert.equal(BRAIN_WAKE_HOOK.SESSION_END, HOOK_EVENT.SESSION_END);
  const spoolTokens: readonly string[] = Object.values(HOOK_EVENT);
  for (const token of Object.values(BRAIN_WAKE_HOOK)) {
    assert.ok(spoolTokens.includes(token), `${token} is a spool token`);
  }
});
