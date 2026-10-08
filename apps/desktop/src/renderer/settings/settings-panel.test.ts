// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { settingsPanelProps } from "#testing/settings-panel-props";
import { SETTINGS_VIEW, type SettingsView, settingsNavRowId } from "../settings-views";
import { SettingsPanel, type SettingsPanelProps } from "./settings-panel";

function mount(props: SettingsPanelProps): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(SettingsPanel, props));
  });
  return container;
}

/** The scroller's direct children, in the order they stand and pin. */
function headOrder(container: ParentNode): readonly string[] {
  const settings = container.querySelector(".settings");
  assert.ok(settings);
  return [...settings.children].map((child) => child.className);
}

beforeEach(() => {
  // The nav rows count their press through the bridge, which a test has none of.
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: { recordSurfaceEvent: () => undefined },
  });
});

afterEach(() => {
  document.body.innerHTML = "";
});

test("on a nested page the search stands above the page's own head", () => {
  for (const view of [SETTINGS_VIEW.APPEARANCE, SETTINGS_VIEW.SHORTCUTS] as const) {
    const order = headOrder(mount(settingsPanelProps({ view, searchOpen: true })));
    const stand = order.indexOf("settings-search-stand");
    const header = order.indexOf("settings-header");
    assert.ok(stand >= 0, `${view} draws the search`);
    assert.ok(header >= 0, `${view} draws its head`);
    assert.ok(
      stand < header,
      `${view}: the search stands at ${stand}, under the head at ${header}`,
    );
  }
});

test("the search closed draws the page's head first, and the front page draws no head", () => {
  const nested = headOrder(mount(settingsPanelProps({ view: SETTINGS_VIEW.APPEARANCE })));
  assert.equal(nested[0], "settings-header");
  assert.equal(nested.includes("settings-search-stand"), false);
  const front = headOrder(
    mount(settingsPanelProps({ view: SETTINGS_VIEW.ROOT, searchOpen: true })),
  );
  assert.equal(front[0], "settings-search-stand");
  assert.equal(front.includes("settings-header"), false);
});

test("a front-page row pressed under an open, empty field closes the field and opens the page", () => {
  const closed: boolean[] = [];
  const opened: SettingsView[] = [];
  const container = mount(
    settingsPanelProps({
      searchOpen: true,
      onSearchClose: () => closed.push(true),
      onViewChange: (view) => opened.push(view),
    }),
  );
  const row = container.querySelector(`#${settingsNavRowId(SETTINGS_VIEW.APPEARANCE)}`);
  assert.ok(row instanceof HTMLButtonElement);
  act(() => {
    row.click();
  });
  assert.deepEqual(closed, [true]);
  assert.deepEqual(opened, [SETTINGS_VIEW.APPEARANCE]);
});
