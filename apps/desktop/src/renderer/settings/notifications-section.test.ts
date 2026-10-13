// @vitest-environment jsdom

import assert from "node:assert/strict";
import { settingsView } from "@sidecar/settings/testing";
import type { AppSettingsView } from "@sidecar/settings/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { settingsPanelProps } from "#testing/settings-panel-props";
import { SETTINGS_VIEW, type SettingsView } from "../settings-views";
import { NOTIFICATIONS_REFUSED_NOTE } from "./notifications-section";
import { SettingsPanel } from "./settings-panel";

const ignore = () => undefined;
const mounted: Root[] = [];

/** Settings › Coding agents, with macOS refusing notifications or not, and the presses of its System Settings button counted. */
function mount(
  refused: boolean,
  settings: AppSettingsView = settingsView(),
  view: SettingsView = SETTINGS_VIEW.CODING_AGENTS,
) {
  const opened: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  act(() => {
    root.render(
      createElement(
        SettingsPanel,
        settingsPanelProps({
          view,
          settings,
          notifications: { refused, onOpenSettings: () => opened.push("System Settings") },
        }),
      ),
    );
  });
  return { container, opened };
}

function notificationsSwitch(container: ParentNode): HTMLButtonElement {
  const control = container.querySelector<HTMLButtonElement>("button[role='switch']");
  assert.ok(control, "Coding agents draws the notifications switch");
  return control;
}

beforeEach(() => {
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: { recordSurfaceEvent: ignore, act: () => Promise.resolve({ ok: true }) },
  });
});

afterEach(() => {
  act(() => {
    for (const root of mounted.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

test("Coding agents offers notifications for a coding agent's end, on until turned off, and the front page does not", () => {
  const front = mount(false, settingsView(), SETTINGS_VIEW.ROOT);
  assert.doesNotMatch(front.container.textContent ?? "", /Notify me when a coding agent finishes/);

  const { container } = mount(false);
  const section = notificationsSwitch(container).closest("section");
  assert.match(section?.querySelector("h2")?.textContent ?? "", /Notifications/);
  assert.match(section?.textContent ?? "", /Notify me when a coding agent finishes/);
  assert.equal(notificationsSwitch(container).getAttribute("aria-checked"), "true");
  assert.doesNotMatch(container.textContent ?? "", new RegExp(NOTIFICATIONS_REFUSED_NOTE));
});

test("while macOS refuses Luke's notifications, the switch says so and opens System Settings; turned off, it needs nothing from macOS", () => {
  const { container, opened } = mount(true);
  assert.match(container.textContent ?? "", new RegExp(NOTIFICATIONS_REFUSED_NOTE));
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
    candidate.textContent?.includes("Open System Settings"),
  );
  assert.ok(button, "the note offers System Settings");
  act(() => button.click());
  assert.deepEqual(opened, ["System Settings"]);

  const off = mount(true, settingsView({ agentNotifications: false }));
  assert.doesNotMatch(off.container.textContent ?? "", new RegExp(NOTIFICATIONS_REFUSED_NOTE));
});
