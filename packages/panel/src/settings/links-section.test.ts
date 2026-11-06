// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import { LINK_OPEN } from "@repo/features/link-open";
import { SETTINGS_ACT_KIND } from "@repo/host/contract";
import { MICROPHONE_STATUS } from "@repo/settings/microphone";
import { NOTIFICATIONS_STATUS } from "@repo/settings/settings-controls";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { appSettingsWire, settingsView } from "@repo/settings/testing";
import { UPDATE_STATUS } from "@repo/settings/update";
import { appSettingsView } from "@repo/settings/wire";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { DESKTOP_CAPABILITIES } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { SettingsPanel, type SettingsPanelProps } from "./settings-panel.js";

const ignore = () => undefined;

const SIGNED_IN: AccountSnapshot = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  email: "dev@example.com",
  name: "Dev",
  provider: "github",
};

function neverChosen() {
  const { stored, ...rest } = appSettingsWire(settingsView());
  const { linkOpen: _never, ...held } = stored;
  return appSettingsView({ ...rest, stored: held });
}

function settingsOn(account: AccountSnapshot): SettingsPanelProps {
  return {
    account,
    onSignOut: () => Promise.resolve(),
    view: SETTINGS_VIEW.ACCOUNT,
    onViewChange: ignore,
    microphone: {
      status: MICROPHONE_STATUS.GRANTED,
      onRequest: ignore,
      onOpenSettings: ignore,
    },
    notifications: {
      status: NOTIFICATIONS_STATUS.UNKNOWN,
      packaged: true,
      onOpenSettings: ignore,
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
      onMoveToApplications: ignore,
      onOpenLatest: ignore,
    },
    settings: neverChosen(),
  };
}

const roots: Root[] = [];

let written: unknown[] = [];

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
  fakeActPort({
    [SETTINGS_ACT_KIND.SETTING_UPDATE]: (payload) => {
      written.push(payload);
      const settings = appSettingsWire(settingsView({ linkOpen: LINK_OPEN.MAC_APP }));
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED, settings });
    },
  });
});

afterEach(() => {
  for (const each of roots.splice(0)) act(() => each.unmount());
  document.body.innerHTML = "";
});

test("Profile asks where Vespin links open, the browser until chosen, and a choice writes the setting", async () => {
  const page = draw(SIGNED_IN);
  assert.equal(page.textContent?.includes("Links"), true);
  const choice =
    page.querySelector<HTMLButtonElement>('button[aria-label="Open Vespin links in: Browser"]') ??
    assert.fail("the row is drawn, naming the browser");
  assert.equal(page.textContent?.includes("Modified"), false);

  act(() => choice.click());
  const app =
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (item) => item.textContent === "Vespin for Mac",
    ) ?? assert.fail("the menu offers Vespin for Mac");
  act(() => app.click());
  await act(async () => undefined);

  assert.deepEqual(written, [{ field: "linkOpen", value: LINK_OPEN.MAC_APP }]);
});

test("signed out, Profile asks nothing about links", () => {
  const page = draw({ status: ACCOUNT_STATUS.SIGNED_OUT });
  assert.equal(page.querySelector('button[aria-label^="Open Vespin links in"]'), null);
});
