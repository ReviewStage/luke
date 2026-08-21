import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { UnparsedWireValue } from "@sidecar/wire";
import type { SessionReplayBootstrap } from "#shared/contracts";
import { POSTHOG_HOST, sessionReplayWanted, withoutLocalAddress } from "./session-replay";

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
 * Switching pageviews off stops it reaching one event; this is what stops it
 * reaching everything else the library puts it in.
 */
const LOCAL = "file:///Users/someone/Applications/Luke.app/renderer/index.html";

function namesNobody(value: UnparsedWireValue): void {
  assert.doesNotMatch(JSON.stringify(value) ?? "", /someone|file:\/\//);
}

test("the address goes from an event's own properties", () => {
  const scrubbed = withoutLocalAddress({ $current_url: LOCAL, $browser: "Chrome" });
  namesNobody(scrubbed);
  // What is not the address is left exactly as the library reported it.
  assert.deepEqual(scrubbed, { $current_url: "app://luke/panel", $browser: "Chrome" });
});

test("the address goes from a captured exception's stack frames", () => {
  namesNobody(
    withoutLocalAddress({
      $exception_list: [
        {
          type: "TypeError",
          stacktrace: { frames: [{ filename: LOCAL, function: "render", lineno: 12 }] },
        },
      ],
    }),
  );
});

test("the address goes from the frames the recorder opens with", () => {
  namesNobody(
    withoutLocalAddress([
      { type: 4, data: { href: LOCAL, width: 640 }, timestamp: 1 },
      { type: 5, data: { tag: "$url_changed", payload: { href: LOCAL } }, timestamp: 2 },
    ]),
  );
});

test("a bare path names the machine as surely as a whole address does", () => {
  // The library reports a path beside the address, and an exception names the
  // script each frame came from rather than the document — so matching the
  // document's own address exactly would have let both through.
  namesNobody(
    withoutLocalAddress({
      $pathname: "/Users/someone/Applications/Luke.app/renderer/index.html",
      $exception_list: [
        {
          stacktrace: {
            frames: [{ filename: "/Users/someone/Applications/Luke.app/renderer/renderer.js" }],
          },
        },
      ],
    }),
  );
});

test("everything that is not the address comes through as it came", () => {
  // A page opened as a file has no referrer, so the library reports the same
  // `$direct` any unreferred visit gets, and that says nothing about anyone.
  const properties = { $referrer: "$direct", $screen_height: 900, nested: { list: [1, "two"] } };
  assert.deepEqual(withoutLocalAddress(properties), properties);
  assert.equal(withoutLocalAddress(undefined), undefined);
});
