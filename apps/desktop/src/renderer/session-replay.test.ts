import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "vitest";
import { withoutLocalAddress } from "./session-replay";

// The recorder drops a `session_recording` option it does not know without a
// word, and the preload rests on a global the library does not declare, so a
// rename of either would look like masking that works or recording that is off.
// The client and the recorder are two bundles now, and the hook the client
// finds the recorder by is one more name a rename would silently lose.
test("the installed bundles still know every name the masking and the recorder rest on", () => {
  const resolve = createRequire(import.meta.url).resolve;
  const client = readFileSync(resolve("posthog-js/dist/module.no-external"), "utf8");
  const recorder = readFileSync(resolve("posthog-js/dist/posthog-recorder"), "utf8");
  const names = [
    "maskTextSelector",
    "maskAttributeFn",
    "ph-no-capture",
    "_POSTHOG_REMOTE_CONFIG",
    "captureCanvas",
    "recordCanvas",
    "capture_performance",
    "enable_recording_console_log",
  ];
  for (const name of names) assert.ok(client.includes(name) || recorder.includes(name), name);
  assert.ok(recorder.includes("__PosthogExtensions__.initSessionRecording"));
});

/**
 * The renderer is a `file://` page, so its address is a path on the
 * developer's own disk and a packaged install sits under `/Users/<name>/`.
 * Switching pageviews off stops it reaching one event; this is what stops it
 * reaching everything else the library puts it in.
 */
const LOCAL = "file:///Users/someone/Applications/Luke.app/renderer/index.html";
/** What the scrub puts in the address's place, as the library will report it. */
const PANEL = "app://luke/panel";

test("the address goes from an event's own properties", () => {
  const scrubbed = withoutLocalAddress({ $current_url: LOCAL, $browser: "Chrome" });
  // What is not the address is left exactly as the library reported it.
  assert.deepEqual(scrubbed, { $current_url: "app://luke/panel", $browser: "Chrome" });
});

test("the address goes from the frames the recorder opens with", () => {
  assert.deepEqual(
    withoutLocalAddress([
      { type: 4, data: { href: LOCAL, width: 640 }, timestamp: 1 },
      { type: 5, data: { tag: "$url_changed", payload: { href: LOCAL } }, timestamp: 2 },
    ]),
    [
      { type: 4, data: { href: PANEL, width: 640 }, timestamp: 1 },
      { type: 5, data: { tag: "$url_changed", payload: { href: PANEL } }, timestamp: 2 },
    ],
  );
});
