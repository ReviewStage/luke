import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SessionReplayBootstrap } from "#shared/contracts";
import { POSTHOG_HOST, sessionReplayWanted } from "./session-replay";

/**
 * The gate, on its own. Recording is the one thing Luke sends that a fixed
 * vocabulary does not bound, so every reason it must not start is asserted
 * here rather than left to be read off three `&&`s.
 */

function bootstrap(over: Partial<SessionReplayBootstrap> = {}): SessionReplayBootstrap {
  return {
    permitted: true,
    appVersion: "1.2.3",
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

/**
 * The recorder's host and the renderer's connect policy are two literals in
 * two files, and nothing at run time reconciles them: a host the policy does
 * not name is refused by the browser, which looks exactly like a recording
 * that never started. Asserted as the whole list rather than as containment,
 * so widening what this renderer may reach at all has to be done deliberately
 * here as well.
 */
test("the connect policy names the recorder's host, and only what else is reached", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const connectSrc = html.match(/connect-src ([^;"]+)/)?.[1];
  assert.deepEqual(connectSrc?.split(" "), ["https://api.openai.com", POSTHOG_HOST]);
});
