import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SessionReplayBootstrap } from "#shared/contracts";
import {
  POSTHOG_HOST,
  sessionReplayWanted,
  withoutLocalAddress,
  withoutRecordedAddress,
} from "./session-replay";

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

/**
 * The renderer is a `file://` page, so its address is a path on the
 * developer's own disk and a packaged install sits under `/Users/<name>/`.
 * Switching pageviews off stops it reaching one event; these are the two
 * places it reaches everything else.
 */
test("this machine's path leaves no event or person property carrying it", () => {
  const scrubbed = withoutLocalAddress({
    $current_url: "file:///Users/someone/Applications/Luke.app/renderer/index.html",
    $pathname: "/Users/someone/Applications/Luke.app/renderer/index.html",
    $initial_current_url: "file:///Users/someone/Applications/Luke.app/renderer/index.html",
    $session_entry_url: "file:///Users/someone/Applications/Luke.app/renderer/index.html",
    $referrer: "$direct",
    $browser: "Chrome",
  });
  for (const [property, value] of Object.entries(scrubbed)) {
    assert.doesNotMatch(String(value), /someone|file:\/\//, `${property} still names the machine`);
  }
  // What is not the address is left exactly as the library reported it: a
  // page opened as a file has no referrer, and that says nothing about anyone.
  assert.equal(scrubbed.$referrer, "$direct");
  assert.equal(scrubbed.$browser, "Chrome");
});

test("the recorder's own frames give up the address they were written with", () => {
  const local = "file:///Users/someone/Applications/Luke.app/renderer/index.html";
  const frames = withoutRecordedAddress([
    { type: 4, data: { href: local, width: 640, height: 480 }, timestamp: 1 },
    { type: 5, data: { tag: "$url_changed", payload: { href: local } }, timestamp: 2 },
    { type: 3, data: { source: 2, id: 7 }, timestamp: 3 },
  ]);
  assert.doesNotMatch(JSON.stringify(frames), /someone|file:\/\//);
  // A frame that never named the address is passed through as it came, rather
  // than rebuilt into something the recorder did not write.
  assert.deepEqual(Array.isArray(frames) ? frames[2] : undefined, {
    type: 3,
    data: { source: 2, id: 7 },
    timestamp: 3,
  });
});

test("anything that is not a frame list is left entirely alone", () => {
  assert.equal(withoutRecordedAddress(undefined), undefined);
  assert.equal(withoutRecordedAddress("not frames"), "not frames");
});
