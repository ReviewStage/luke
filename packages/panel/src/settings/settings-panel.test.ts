// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { SETTINGS_PAGE_LIST, SETTINGS_VIEW } from "@luke/settings/settings-views";
import { UPDATE_STATUS } from "@luke/settings/update";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { NOTIFICATIONS_STATUS } from "@luke/voice/settings-controls";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ellipsized } from "../testing/action-label.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { DESKTOP_CAPABILITIES } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { settingsPageOf } from "./pages.js";
import { SettingsPanel, type SettingsPanelProps } from "./settings-panel.js";

/**
 * Settings' Account page as the panel draws it: its own groups and no list of
 * the other pages, which the Settings sidebar alone lists; and no page's
 * buttons end their words with an ellipsis.
 */

const ignore = () => undefined;
const accepted = () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });

/** A signed-in account's Settings, every press ignored. */
const SETTINGS: SettingsPanelProps = {
  account: {
    status: ACCOUNT_STATUS.SIGNED_IN,
    email: "dev@example.com",
    name: "Dev",
    provider: "github",
  },
  onSignOut: () => Promise.resolve(),
  onDeleteAccount: accepted,
  view: SETTINGS_VIEW.ACCOUNT,
  onViewChange: ignore,
  microphone: {
    status: MICROPHONE_STATUS.GRANTED,
    voiceAvailable: true,
    onRequest: ignore,
    onOpenSettings: ignore,
  },
  notifications: {
    status: NOTIFICATIONS_STATUS.UNKNOWN,
    packaged: true,
    onOpenSettings: ignore,
    onTest: ignore,
  },
  capabilities: DESKTOP_CAPABILITIES,
  updates: {
    update: {
      status: UPDATE_STATUS.IDLE,
      currentVersion: "1.0.0",
      installSupported: true,
      upToDate: false,
    },
    build: { packaged: false },
    onCheck: () => Promise.resolve(),
    onInstall: ignore,
    onOpenLatest: ignore,
  },
  shortcuts: {
    voiceHotkeyHeld: false,
    voiceChosen: false,
    voiceOff: false,
    onVoiceHotkeyChange: accepted,
    stopChosen: false,
    stopOff: false,
    onStopHotkeyChange: accepted,
    onCapture: ignore,
  },
};

const roots: Root[] = [];

beforeEach(() => {
  fakeAppBridge({
    act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }),
  });
});

afterEach(() => {
  for (const each of roots.splice(0)) act(() => each.unmount());
  document.body.innerHTML = "";
});

test("the Account page lists none of the other pages, which the Settings sidebar alone lists", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(SettingsPanel, SETTINGS))));

  const pressed = [...container.querySelectorAll("button")].map((button) => button.textContent);
  for (const page of SETTINGS_PAGE_LIST.filter((each) => each !== SETTINGS_VIEW.ACCOUNT)) {
    assert.equal(
      pressed.some((words) => words?.includes(settingsPageOf(page).title)),
      false,
      `the Account page offers no ${settingsPageOf(page).title} row`,
    );
  }
});

test("a signed-out Workspace page says to sign in rather than drawing nothing", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(SettingsPanel, {
          ...SETTINGS,
          account: { status: ACCOUNT_STATUS.SIGNED_OUT },
          view: SETTINGS_VIEW.WORKSPACE,
        }),
      ),
    ),
  );

  assert.equal(container.textContent, "Sign in to see your workspaces.");
});

test("no Settings page draws a button whose words end with an ellipsis", () => {
  for (const view of SETTINGS_PAGE_LIST) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    act(() =>
      root.render(
        onRegistry(AtomRegistry.make(), createElement(SettingsPanel, { ...SETTINGS, view })),
      ),
    );

    const pressed = [...container.querySelectorAll("button")].map((button) => button.textContent);
    assert.deepEqual(ellipsized(pressed), [], `the ${settingsPageOf(view).title} page`);
  }
});
