import assert from "node:assert/strict";
import test from "node:test";
import { BRAIN_WAKE_KIND } from "@sidecar/brain";
import { normalizeSession, SESSION_STATUS, type Session } from "@sidecar/session";
import { wakeEventsFromHooks } from "./flow";

const NOW = 1_800_000_000_000;

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
