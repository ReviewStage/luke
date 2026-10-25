// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { UPDATE_STATUS } from "@luke/settings/update";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { type SettingsDoors, useSettingsPanel } from "./app-settings.js";
import { rendererRegistry } from "./renderer-runtime.js";
import type { SettingsPanelProps } from "./settings/settings-panel.js";
import { fakeActPort, refusedOnPort } from "./testing/app-bridge.js";
import { fakeAppPlatform } from "./testing/app-platform.js";
import { handState } from "./testing/app-state.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { ToastHost } from "./toast.js";

/**
 * Settings' doors to the host as the developer presses them: Restart, held
 * by a downloaded update, is an act pressed for, so a refusal main draws is
 * said in a toast in main's own words rather than swallowed. Synthetic
 * versions throughout.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

const DOORS: SettingsDoors = {
  view: SETTINGS_VIEW.ACCOUNT,
  onViewChange: () => undefined,
  onSignOut: () => Promise.resolve(),
  onDeleteAccount: () => Promise.reject(new Error("Not in this test.")),
  onRequestMicrophone: () => undefined,
  // SAFETY: the doors under test never reach the workspace's own control.
  workspace: {} as SettingsDoors["workspace"],
};

/** Settings' props as drawn over a downloaded update, with main refusing every install in `sentence`, beside the window's toasts. */
async function mountRefusingInstall(sentence: string): Promise<() => SettingsPanelProps> {
  handState(
    {},
    {
      update: {
        status: UPDATE_STATUS.READY,
        currentVersion: "1.0.0",
        installSupported: true,
        latestVersion: "1.1.0",
      },
    },
  );
  fakeAppPlatform({});
  fakeActPort({
    [ACT_KIND.UPDATE_INSTALL]: () => Promise.reject(refusedOnPort(sentence)),
  });
  let panel: SettingsPanelProps | undefined;
  function Probe(): null {
    panel = useSettingsPanel(DOORS);
    return null;
  }
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      createElement(
        Fragment,
        null,
        onRegistry(AtomRegistry.make(), createElement(Probe)),
        onRegistry(rendererRegistry, createElement(ToastHost)),
      ),
    ),
  );
  return () => panel ?? assert.fail("Settings drew nothing");
}

/** What each toast standing says, oldest first. */
function toasts(): string[] {
  return [...document.querySelectorAll(".luke-toast:not([data-leaving]) .luke-toast-words")].map(
    (words) => words.textContent ?? "",
  );
}

test("a Restart main refuses raises a toast in main's own words", async () => {
  const refusal = "Luke can't restart while a call is open.";
  const panel = await mountRefusingInstall(refusal);

  await act(async () => panel().updates.onInstall());

  assert.ok(toasts().includes(refusal), `toasts stood: ${toasts().join(" | ")}`);
});
