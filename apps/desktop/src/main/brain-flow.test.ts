import assert from "node:assert/strict";
import test from "node:test";
import { BRAIN_STATE_VERSION } from "@sidecar/brain";
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

test("every hook event becomes an event for the next look, dated now when the spool carried no time", () => {
  const wakes = wakeEventsFromHooks(
    "claude-code",
    [
      { providerSessionId: "session-a", event: "stop", atMs: NOW - 500 },
      { providerSessionId: "session-b", event: "prompt", atMs: Number.NaN },
    ],
    NOW,
  );

  assert.deepEqual(wakes, [
    {
      identity: { providerId: "claude-code", providerSessionId: "session-a" },
      hookEvent: "stop",
      atMs: NOW - 500,
    },
    {
      identity: { providerId: "claude-code", providerSessionId: "session-b" },
      hookEvent: "prompt",
      atMs: NOW,
    },
  ]);
});
