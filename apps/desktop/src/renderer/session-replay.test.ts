import assert from "node:assert/strict";
import test from "node:test";
import type { SessionReplayBootstrap } from "#shared/contracts";
import { sessionReplayWanted } from "./session-replay";

/**
 * The gate, on its own. Recording is the one thing Luke sends that a fixed
 * vocabulary does not bound, so every reason it must not start is asserted
 * here rather than left to be read off three `&&`s.
 */

function bootstrap(over: Partial<SessionReplayBootstrap> = {}): SessionReplayBootstrap {
  return {
    permitted: true,
    ingestHost: "https://tryluke.dev/ingest",
    accountId: "user-1",
    ...over,
  };
}

test("both switches on, in a run that may record, is the only yes", () => {
  assert.equal(sessionReplayWanted(bootstrap(), true, true), true);
});

test("a fixture or capture run records nothing whatever the switches say", () => {
  // `permitted` is where `runMode.sendsNetwork` arrives, so this is the same
  // suppression the event sender takes — and the reason an evidence run
  // reaches no network.
  assert.equal(sessionReplayWanted(bootstrap({ permitted: false }), true, true), false);
});

test("sharing is the outer switch: recording cannot outlive it", () => {
  assert.equal(sessionReplayWanted(bootstrap(), false, true), false);
  // And the recording switch alone still stops it, without giving up counts.
  assert.equal(sessionReplayWanted(bootstrap(), true, false), false);
  assert.equal(sessionReplayWanted(bootstrap(), false, false), false);
});

test("no account means no recording, because none could be erased with one", () => {
  assert.equal(sessionReplayWanted(bootstrap({ accountId: undefined }), true, true), false);
});
