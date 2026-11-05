// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PRODUCT_PLATFORM } from "@repo/features/analytics";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
    "maskTextFn",
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

/** A shell that records, its recorder standing in. */
function testShell(): Parameters<typeof sessionReplay>[0] {
  return {
    platform: PRODUCT_PLATFORM.DESKTOP,
    projectApiKey: () => "test-project-key",
    host: { api: "https://us.i.posthog.com", ui: "https://us.posthog.com" },
    address: "app://desktop/panel",
    namesOwnAddress: () => false,
    importRecorder: () => Promise.resolve(undefined),
  };
}

// The app's own words leave as they read only under the unmask mark with no
// nearer mask mark, and never where words are typed; every other word leaves
// as asterisks of its own length, so a mark that stopped reaching nested
// words, or a mask mark that lost to an outer unmask, would show a person's
// words in every recording.
test("the recorder is handed a text masking that shows only the words under the unmask mark", async () => {
  window.__PosthogExtensions__ = { initSessionRecording: () => undefined };
  sessionReplay(testShell())({
    permitted: true,
    appVersion: "0.0.0",
    packaged: true,
    accountId: "user-1",
  });
  await vi.waitFor(() => assert.ok(client.calls.some(([name]) => name === "init")));
  const options = client.calls.find(([name]) => name === "init")?.[2] as {
    session_recording: { maskTextFn: (text: string, element?: HTMLElement | null) => string };
  };
  const mask = options.session_recording.maskTextFn;
  document.body.innerHTML = renderToStaticMarkup(
    h(
      "div",
      null,
      h(
        ReplayUnmask,
        null,
        h("b", null, "Move to"),
        h(ReplayMask, null, h("i", null, "Alex")),
        h("div", { contentEditable: true, suppressContentEditableWarning: true }, "Typed"),
      ),
      h("u", null, "Plain"),
    ),
  );
  const at = (selector: string) => document.querySelector<HTMLElement>(selector);

  assert.equal(mask("Move to", at("b")), "Move to");
  assert.equal(mask("Alex", at("i")), "****");
  assert.equal(mask("Typed", at("[contenteditable]")), "*****");
  assert.equal(mask("Plain words", at("u")), "***** *****");
  assert.equal(mask("Orphan", null), "******");
});

// A recording is filed under the workspace the window lists, so a team's
// recordings can be found by it: grouped as one is listed, regrouped on a
// switch, ungrouped once none is listed, and let go with the person on a stop.
test("a recording is grouped under the listed workspace, follows a switch, and lets the group go on a stop", async () => {
  window.__PosthogExtensions__ = { initSessionRecording: () => undefined };
  const apply = sessionReplay(testShell());
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
