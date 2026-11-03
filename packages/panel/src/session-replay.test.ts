// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PRODUCT_PLATFORM } from "@repo/features/analytics";
import { afterEach, expect, test, vi } from "vitest";
import { sessionReplay } from "./session-replay.js";

/** The client as the controller drives it, every call heard in one order. */
const client = vi.hoisted(() => {
  const calls: unknown[][] = [];
  const heard =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  return {
    calls,
    posthog: Object.fromEntries(
      [
        "init",
        "opt_in_capturing",
        "opt_out_capturing",
        "register",
        "identify",
        "reset",
        "group",
        "resetGroups",
        "startSessionRecording",
        "stopSessionRecording",
      ].map((name) => [name, heard(name)]),
    ),
  };
});

vi.mock("posthog-js/dist/module.no-external", () => ({ default: client.posthog }));

afterEach(() => {
  client.calls.length = 0;
  delete window.__PosthogExtensions__;
});

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
    "maskAllInputs",
    "slimDOMOptions",
    "recordHeaders",
    "recordBody",
    "ph-no-capture",
    "ph-ignore-input",
    "_POSTHOG_REMOTE_CONFIG",
    "captureCanvas",
    "recordCanvas",
    "capture_performance",
    "enable_recording_console_log",
  ];
  for (const name of names) assert.ok(client.includes(name) || recorder.includes(name), name);
  assert.ok(recorder.includes("__PosthogExtensions__.initSessionRecording"));
});

// A recording is filed under the workspace the window lists, so a team's
// recordings can be found by it: grouped as one is listed, regrouped on a
// switch, ungrouped once none is listed, and let go with the person on a stop.
test("a recording is grouped under the listed workspace, follows a switch, and lets the group go on a stop", async () => {
  window.__PosthogExtensions__ = { initSessionRecording: () => undefined };
  const apply = sessionReplay({
    platform: PRODUCT_PLATFORM.DESKTOP,
    projectApiKey: () => "test-project-key",
    host: { api: "https://us.i.posthog.com", ui: "https://us.posthog.com" },
    address: "app://desktop/panel",
    namesOwnAddress: () => false,
    importRecorder: () => Promise.resolve(undefined),
  });
  const word = { permitted: true, appVersion: "0.0.0", packaged: true, accountId: "user-1" };
  const groupCalls = () =>
    client.calls.filter(([name]) => name === "group" || name === "resetGroups" || name === "reset");

  apply({ ...word, workspaceId: "team-1" });
  await vi.waitFor(() => expect(groupCalls()).toEqual([["group", "workspace", "team-1"]]));
  apply({ ...word, workspaceId: "team-1" });
  apply({ ...word, workspaceId: "team-2" });
  apply(word);
  apply({ ...word, permitted: false });
  apply({ ...word, workspaceId: "team-2" });

  assert.deepEqual(groupCalls(), [
    ["group", "workspace", "team-1"],
    ["group", "workspace", "team-2"],
    ["resetGroups"],
    ["reset"],
    ["group", "workspace", "team-2"],
  ]);
});
