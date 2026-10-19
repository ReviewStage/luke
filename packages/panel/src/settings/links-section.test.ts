// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import { LINK_OPEN } from "@luke/features/link-open";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { appSettingsWire, settingsView } from "@luke/settings/testing";
import { UPDATE_STATUS } from "@luke/settings/update";
import { appSettingsView } from "@luke/settings/wire";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { NOTIFICATIONS_STATUS } from "@luke/voice/settings-controls";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { DESKTOP_CAPABILITIES } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { SettingsPanel, type SettingsPanelProps } from "./settings-panel.js";

/**
 * Settings › Profile's Links group as the panel draws it: where the
 * account's Luke links open, a pop-up naming the browser until the account
 * chooses, whose choice is written as the setting; and nothing of it while
 * signed out, since the choice is the account's.
 */

const ignore = () => undefined;

const SIGNED_IN: AccountSnapshot = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  email: "dev@example.com",
  name: "Dev",
  provider: "github",
};

/** The settings a store sends that never held a link choice, drawn as the window draws them. */
function neverChosen() {
  const { stored, ...rest } = appSettingsWire(settingsView());
  const { linkOpen: _never, ...held } = stored;
  return appSettingsView({ ...rest, stored: held });
}

/** Settings on the Profile page for the account given, every press but a setting's write ignored. */
function settingsOn(account: AccountSnapshot): SettingsPanelProps {
  return {
    account,
    onSignOut: () => Promise.resolve(),
    onDeleteAccount: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
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
      build: { packaged: true },
      onCheck: () => Promise.resolve(),
      onInstall: ignore,
      onOpenLatest: ignore,
    },
    settings: neverChosen(),
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

const roots: Root[] = [];

/** Each setting written through the bridge, as its act carried it. */
let written: unknown[] = [];

/** Draws Settings on the Profile page and answers the container. */
function draw(account: AccountSnapshot): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(onRegistry(AtomRegistry.make(), createElement(SettingsPanel, settingsOn(account)))),
  );
  return container;
}

beforeEach(() => {
  written = [];
  fakeAppBridge({
    act: (request: Act): Promise<ActOutcome> => {
      if (request.kind !== ACT_KIND.SETTING_UPDATE) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
      }
      written.push(request.payload);
      const settings = appSettingsWire(settingsView({ linkOpen: LINK_OPEN.MAC_APP }));
      const value = { status: ACTION_RESULT_STATUS.ACCEPTED, settings };
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
    },
  });
});

afterEach(() => {
  for (const each of roots.splice(0)) act(() => each.unmount());
  document.body.innerHTML = "";
});

test("Profile asks where Luke links open, the browser until chosen, and a choice writes the setting", async () => {
  const page = draw(SIGNED_IN);
  assert.equal(page.textContent?.includes("Links"), true);
  const choice =
    page.querySelector<HTMLButtonElement>('button[aria-label="Open Luke links in: Browser"]') ??
    assert.fail("the row is drawn, naming the browser");
  // Note that the browser is the default, so a row that never chose wears no mark of a change.
  assert.equal(page.textContent?.includes("Modified"), false);

  act(() => choice.click());
  const app =
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')].find(
      (item) => item.textContent === "Luke for Mac",
    ) ?? assert.fail("the menu offers Luke for Mac");
  act(() => app.click());
  await act(async () => undefined);

  assert.deepEqual(written, [{ field: "linkOpen", value: LINK_OPEN.MAC_APP }]);
});

test("signed out, Profile asks nothing about links", () => {
  const page = draw({ status: ACCOUNT_STATUS.SIGNED_OUT });
  assert.equal(page.querySelector('button[aria-label^="Open Luke links in"]'), null);
});
