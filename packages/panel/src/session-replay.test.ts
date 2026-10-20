import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "vitest";

// The recorder drops a `session_recording` option it does not know without a
// word, and the preload rests on a global the library does not declare, so a
// rename of either would look like masking that works or recording that is off.
// The client and the recorder are two bundles, and the hook the client finds
// the recorder by is one more name a rename would silently lose.
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
