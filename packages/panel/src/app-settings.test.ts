// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND } from "@repo/host/acts";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { UPDATE_STATUS } from "@repo/settings/update";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { type SettingsDoors, useSettingsPanel } from "./app-settings.js";
import { rendererRegistry } from "./renderer-runtime.js";
import type { SettingsPanelProps } from "./settings/settings-panel.js";
import { fakeActPort, refusedOnPort } from "./testing/app-bridge.js";
import { fakeAppPlatform } from "./testing/app-platform.js";
import { handState } from "./testing/app-state.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { ToastHost } from "./toast.js";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

const DOORS: SettingsDoors = {
  view: SETTINGS_VIEW.ACCOUNT,
  onViewChange: () => undefined,
  onSignOut: () => Promise.resolve(),
  onRequestMicrophone: () => undefined,
  workspace: {} as SettingsDoors["workspace"],
};

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
  await vi.waitFor(() => assert.equal(panel?.updates !== undefined, true));
  return () => panel ?? assert.fail("Settings drew nothing");
}

function toasts(): string[] {
  return [...document.querySelectorAll(".ui-toast:not([data-leaving]) .ui-toast-words")].map(
    (words) => words.textContent ?? "",
  );
}

test("a Restart main refuses raises a toast in main's own words", async () => {
  const refusal = "Vespin can't restart while a call is open.";
  const panel = await mountRefusingInstall(refusal);

  await act(async () => panel().updates.onInstall());

  assert.ok(toasts().includes(refusal), `toasts stood: ${toasts().join(" | ")}`);
});
