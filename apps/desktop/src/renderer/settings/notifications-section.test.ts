// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { settingsView } from "@luke/settings/testing";
import { UPDATE_STATUS } from "@luke/settings/update";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { NOTIFICATIONS_STATUS, type NotificationsControl } from "@luke/voice/settings-controls";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { onRegistry } from "#testing/copy-feedback";
import { SettingsPanel, type SettingsPanelProps } from "./settings-panel";

/**
 * Settings › Notifications as the panel draws it: a test notification posted
 * on a press, and what macOS last answered said plainly, naming Electron in
 * a development build, which is the app macOS knows it as.
 */

const ignore = () => undefined;

/** A signed-in account's Settings on the Notifications page, every press but the notifications' ignored. */
function settingsOn(notifications: NotificationsControl): SettingsPanelProps {
  return {
    account: {
      status: ACCOUNT_STATUS.SIGNED_IN,
      email: "dev@example.com",
      name: "Dev",
      provider: "github",
    },
    onSignOut: () => Promise.resolve(),
    onDeleteAccount: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    view: SETTINGS_VIEW.NOTIFICATIONS,
    onViewChange: ignore,
    microphone: {
      status: MICROPHONE_STATUS.GRANTED,
      voiceAvailable: true,
      onRequest: ignore,
      onOpenSettings: ignore,
    },
    notifications,
    updates: {
      update: {
        status: UPDATE_STATUS.IDLE,
        currentVersion: "1.0.0",
        installSupported: true,
        upToDate: false,
      },
      build: { packaged: notifications.packaged },
      onCheck: () => Promise.resolve(),
      onInstall: ignore,
      onOpenLatest: ignore,
    },
    settings: settingsView(),
    shortcuts: {
      voiceHotkeyHeld: false,
      voiceChosen: false,
      voiceOff: false,
      onVoiceHotkeyChange: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      stopChosen: false,
      stopOff: false,
      onStopHotkeyChange: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      onCapture: ignore,
    },
  };
}

/** The notifications' control at the given answer from macOS, its presses ignored. */
function control(overrides: Partial<NotificationsControl>): NotificationsControl {
  return {
    status: NOTIFICATIONS_STATUS.UNKNOWN,
    packaged: true,
    onOpenSettings: ignore,
    onTest: ignore,
    ...overrides,
  };
}

const roots: Root[] = [];

/** Draws Settings on the Notifications page and answers the container. */
function draw(notifications: NotificationsControl): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(AtomRegistry.make(), createElement(SettingsPanel, settingsOn(notifications))),
    ),
  );
  return container;
}

function button(container: HTMLElement, words: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((each) => each.textContent === words);
}

beforeEach(() => {
  fakeAppBridge({
    act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }),
    recordSurfaceEvent: () => undefined,
  });
});

afterEach(() => {
  for (const each of roots.splice(0)) act(() => each.unmount());
  document.body.innerHTML = "";
});

test("Send test notification posts one, and the row says when Luke notifies at all", () => {
  let tests = 0;
  const container = draw(control({ onTest: () => (tests += 1) }));

  act(() => button(container, "Send test notification")?.click());

  assert.equal(tests, 1);
  assert.match(
    container.textContent ?? "",
    /Luke notifies only when its window is in the background\./,
  );
});

test("before macOS has answered, nothing is said of whether notifications are on", () => {
  const container = draw(control({ status: NOTIFICATIONS_STATUS.UNKNOWN }));

  assert.doesNotMatch(container.textContent ?? "", /macOS (has|showed)/);
  assert.equal(button(container, "Open System Settings"), undefined);
});

test("once macOS refused one, the page says notifications are off and opens System Settings", () => {
  let opened = 0;
  const container = draw(
    control({ status: NOTIFICATIONS_STATUS.OFF, onOpenSettings: () => (opened += 1) }),
  );

  act(() => button(container, "Open System Settings")?.click());

  assert.match(container.textContent ?? "", /macOS has notifications off for Luke\./);
  assert.equal(opened, 1);
});

test("a development build names Electron, which is how macOS lists it", () => {
  const container = draw(control({ status: NOTIFICATIONS_STATUS.OFF, packaged: false }));

  assert.match(
    container.textContent ?? "",
    /macOS has notifications off for Electron, which is how the dev build appears to macOS\./,
  );
});

test("once macOS showed one, the page says notifications are on and asks nothing", () => {
  const container = draw(control({ status: NOTIFICATIONS_STATUS.ON }));

  assert.match(
    container.textContent ?? "",
    /macOS showed Luke's last notification, so notifications are on\./,
  );
  assert.equal(button(container, "Open System Settings"), undefined);
});
