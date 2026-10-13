// @vitest-environment jsdom

import assert from "node:assert/strict";
import { settingsView } from "@sidecar/settings/testing";
import type { AppSettingsView } from "@sidecar/settings/wire";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "#shared/messages/acts";
import { settingsPanelProps } from "#testing/settings-panel-props";
import { SETTINGS_VIEW, type SettingsView } from "../settings-views";
import { SettingsPanel } from "./settings-panel";

const ignore = () => undefined;
const mounted: Root[] = [];

/** Settings on one page, over an act channel that keeps what it is asked. */
function mount(settings: AppSettingsView, view: SettingsView = SETTINGS_VIEW.ROOT) {
  const sent: Act[] = [];
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      recordSurfaceEvent: ignore,
      act: (request: Act) => {
        sent.push(request);
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.DONE,
          value: {
            status: ACTION_RESULT_STATUS.ACCEPTED,
            settings: { stored: settings, status: { voiceAvailable: settings.voiceAvailable } },
          },
        });
      },
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  act(() => {
    root.render(createElement(SettingsPanel, settingsPanelProps({ view, settings })));
  });
  return { container, sent };
}

function commandsSwitch(container: ParentNode): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button[role='switch']")].find(
    (control) =>
      control
        .closest(".settings-row")
        ?.textContent?.includes("Let agents run commands on this Mac"),
  );
}

afterEach(() => {
  act(() => {
    for (const root of mounted.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

test("General offers the switch that lets agents run commands on this Mac, on until turned off, and pressing it writes it", () => {
  const { container, sent } = mount(settingsView());
  const control = commandsSwitch(container);
  assert.ok(control, "General draws the switch");
  assert.match(control.closest("section")?.querySelector("h2")?.textContent ?? "", /Commands/);
  assert.equal(control.getAttribute("aria-checked"), "true");

  act(() => control.click());

  assert.deepEqual(
    sent.filter((request) => request.kind === ACT_KIND.SETTING_UPDATE),
    [{ kind: ACT_KIND.SETTING_UPDATE, payload: { field: "macCommands", value: false } }],
  );
  const off = mount(settingsView({ macCommands: false }));
  assert.equal(commandsSwitch(off.container)?.getAttribute("aria-checked"), "false");
  const appearance = mount(settingsView(), SETTINGS_VIEW.APPEARANCE);
  assert.equal(commandsSwitch(appearance.container), undefined, "only General draws it");
});
