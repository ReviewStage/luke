// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { settingsView } from "@sidecar/settings/testing";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { UPDATE_STATUS } from "#shared/messages/update";
import { SETTINGS_VIEW, type SettingsView, settingsNavRowId } from "../settings-views";
import { SettingsPanel, type SettingsPanelProps } from "./settings-panel";

const accepted = () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED } as const);

function panelProps(overrides: Partial<SettingsPanelProps> = {}): SettingsPanelProps {
  return {
    account: { status: ACCOUNT_STATUS.SIGNED_OUT },
    onSignOut: () => Promise.resolve(),
    onDeleteAccount: accepted,
    view: SETTINGS_VIEW.ROOT,
    onViewChange: () => undefined,
    microphone: {
      status: MICROPHONE_STATUS.GRANTED,
      voiceAvailable: true,
      onRequest: () => undefined,
      onOpenSettings: () => undefined,
    },
    updates: {
      update: {
        status: UPDATE_STATUS.IDLE,
        currentVersion: "0.0.0",
        installSupported: false,
        upToDate: false,
      },
      onCheck: () => Promise.resolve(),
      onInstall: () => undefined,
      onOpenLatest: () => undefined,
    },
    settings: settingsView({ voiceAvailable: true }),
    credentials: {
      begin: () => undefined,
      connect: () => undefined,
      change: () => undefined,
      fetchKey: () => undefined,
      cancel: () => undefined,
      commit: () => undefined,
      remove: accepted,
    },
    feedback: {
      begin: () => undefined,
      changeMessage: () => undefined,
      changeName: () => undefined,
      changeEmail: () => undefined,
      attach: () => undefined,
      removeImage: () => undefined,
      dismiss: () => undefined,
      cancel: () => undefined,
      commit: () => undefined,
    },
    panelOpen: true,
    workspaceProviders: [],
    calendar: {
      choices: [],
      held: false,
      connecting: false,
      onSignIn: () => undefined,
      onRemoveAccount: accepted,
      onToggleCalendar: accepted,
      onRefresh: () => Promise.resolve(),
    },
    appleCalendar: {
      choices: [],
      held: false,
      connecting: false,
      revoked: false,
      onSignIn: () => undefined,
      onDisconnect: accepted,
      onToggleCalendar: accepted,
    },
    onQuit: () => undefined,
    shortcuts: {
      voiceHotkeyHeld: false,
      voiceChosen: false,
      voiceOff: false,
      onVoiceHotkeyChange: accepted,
      stopChosen: false,
      stopOff: false,
      onStopHotkeyChange: accepted,
      onCapture: () => undefined,
    },
    searchOpen: false,
    onSearchClose: () => undefined,
    onSearchEngaged: () => undefined,
    ...overrides,
  };
}

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
    const order = headOrder(mount(panelProps({ view, searchOpen: true })));
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
  const nested = headOrder(mount(panelProps({ view: SETTINGS_VIEW.APPEARANCE })));
  assert.equal(nested[0], "settings-header");
  assert.equal(nested.includes("settings-search-stand"), false);
  const front = headOrder(mount(panelProps({ view: SETTINGS_VIEW.ROOT, searchOpen: true })));
  assert.equal(front[0], "settings-search-stand");
  assert.equal(front.includes("settings-header"), false);
});

test("a front-page row pressed under an open, empty field closes the field and opens the page", () => {
  const closed: boolean[] = [];
  const opened: SettingsView[] = [];
  const container = mount(
    panelProps({
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
