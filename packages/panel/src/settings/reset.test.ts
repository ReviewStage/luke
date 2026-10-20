// @vitest-environment jsdom

import assert from "node:assert/strict";
import { APP_SETTING_DEFAULTS, HOST_CAPABILITY, type HostCapability, THEME } from "@luke/settings";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { appSettingsWire, settingsView } from "@luke/settings/testing";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { DESKTOP_CAPABILITIES } from "../testing/app-state.js";
import { newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { pageResetControl } from "./reset.js";
import type { SettingsWrites } from "./writes.js";

/**
 * reset.test.ts -- a page's reset that the store refuses says why in a
 * failure's toast, announced as an alert, and the reset stands pressable
 * again; a page offers its reset only for a change to a row it draws, and
 * resets only the rows it draws.
 */

const REFUSED = "The settings could not be reset. Try again.";

const roots: Root[] = [];

afterEach(() => {
  for (const each of roots.splice(0)) act(() => each.unmount());
  document.body.innerHTML = "";
});

/** The page's settings as they stand: the theme moved off its default, so the page offers its reset. */
const settings = settingsView({ theme: THEME.DARK });

/** Which rows a platform offering `capabilities` draws for `shown`, with every voice control and the account standing. */
function rowsOn(
  shown: typeof settings,
  capabilities: readonly HostCapability[],
  voiceControlsDrawn = true,
) {
  return { settings: shown, voiceControlsDrawn, accountDrawn: true, capabilities };
}

const writes: SettingsWrites = {
  setting: () => Promise.reject(new Error("a reset writes no single setting")),
  reset: () =>
    Promise.resolve({
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: REFUSED,
      settings: appSettingsWire(settings),
    }),
};

test("a refused reset says why in a toast and can be pressed again", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        "div",
        null,
        pageResetControl(
          SETTINGS_VIEW.APPEARANCE,
          settings,
          writes,
          rowsOn(settings, DESKTOP_CAPABILITIES),
        ),
        createElement(ToastHost),
      ),
    ),
  );
  const reset = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Reset to defaults",
  );
  assert.ok(reset, "the page offers its reset");

  await act(async () => reset.click());

  assert.equal(newestToastSays()?.includes(REFUSED), true);
  assert.equal(document.querySelector('[role="alert"]')?.textContent?.includes(REFUSED), true);
  assert.equal(reset.disabled, false);
});

test("a zoom changed in a browser, which draws no Zoom row, offers no reset on Appearance; the desktop, which draws it, does", () => {
  const zoomed = settingsView({ zoom: 125 });
  const browser = DESKTOP_CAPABILITIES.filter((each) => each !== HOST_CAPABILITY.DESKTOP_APP);

  assert.equal(
    pageResetControl(SETTINGS_VIEW.APPEARANCE, zoomed, writes, rowsOn(zoomed, browser)),
    undefined,
  );
  assert.notEqual(
    pageResetControl(
      SETTINGS_VIEW.APPEARANCE,
      zoomed,
      writes,
      rowsOn(zoomed, DESKTOP_CAPABILITIES),
    ),
    undefined,
  );
});

test("captions turned on while the Voice page holds only its way in offer no reset there; once its controls are drawn they do", () => {
  const captioned = settingsView({ voiceCaptions: true });

  assert.equal(
    pageResetControl(
      SETTINGS_VIEW.VOICE,
      captioned,
      writes,
      rowsOn(captioned, DESKTOP_CAPABILITIES, false),
    ),
    undefined,
  );
  assert.notEqual(
    pageResetControl(
      SETTINGS_VIEW.VOICE,
      captioned,
      writes,
      rowsOn(captioned, DESKTOP_CAPABILITIES),
    ),
    undefined,
  );
});

/** A store holding `start`, whose reset returns the Appearance group to its defaults in one write but for the fields it is asked to keep, as the host's does. */
function appearanceStore(start: typeof settings) {
  let held = start;
  const writes: SettingsWrites = {
    setting: (field, value) => {
      held = Object.assign(settingsView(), held, { [field]: value });
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
    },
    reset: (_scope, kept) => {
      const reset = {
        theme: APP_SETTING_DEFAULTS.theme,
        zoom: APP_SETTING_DEFAULTS.zoom,
        openAtLogin: APP_SETTING_DEFAULTS.openAtLogin,
      };
      held = Object.assign(
        settingsView(),
        held,
        Object.fromEntries(
          Object.entries(reset).filter(([field]) => !kept.some((each) => each === field)),
        ),
      );
      return Promise.resolve({
        status: ACTION_RESULT_STATUS.ACCEPTED,
        settings: appSettingsWire(held),
      });
    },
  };
  return { writes, now: () => held };
}

test("a browser's Appearance reset returns the theme it draws to its default and keeps the zoom it does not draw", async () => {
  const start = settingsView({ theme: THEME.DARK, zoom: 125 });
  const store = appearanceStore(start);
  const browser = DESKTOP_CAPABILITIES.filter((each) => each !== HOST_CAPABILITY.DESKTOP_APP);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        "div",
        null,
        pageResetControl(SETTINGS_VIEW.APPEARANCE, start, store.writes, rowsOn(start, browser)),
        createElement(ToastHost),
      ),
    ),
  );
  const reset = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Reset to defaults",
  );
  assert.ok(reset, "the page offers its reset");

  await act(async () => reset.click());

  assert.equal(store.now().theme, APP_SETTING_DEFAULTS.theme);
  assert.equal(store.now().zoom, 125);
});

test("Undo after a browser's reset puts back the theme it reset and leaves the zoom another window changed meanwhile", async () => {
  const start = settingsView({ theme: THEME.DARK, zoom: 125 });
  const store = appearanceStore(start);
  const browser = DESKTOP_CAPABILITIES.filter((each) => each !== HOST_CAPABILITY.DESKTOP_APP);
  // Another window saves a zoom just before the reset reaches the store.
  const reset = store.writes.reset;
  store.writes.reset = (scope, kept) =>
    store.writes.setting("zoom", 150).then(() => reset(scope, kept));
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        "div",
        null,
        pageResetControl(SETTINGS_VIEW.APPEARANCE, start, store.writes, rowsOn(start, browser)),
        createElement(ToastHost),
      ),
    ),
  );
  const press = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Reset to defaults",
  );
  assert.ok(press, "the page offers its reset");
  await act(async () => press.click());
  // The newest toast's Undo: an earlier test's toast may still stand in the shared host.
  const undo = [...document.querySelectorAll("button")]
    .filter((button) => button.textContent === "Undo")
    .at(-1);
  assert.ok(undo, "the reset offers its Undo");

  await act(async () => undo.click());

  assert.equal(store.now().theme, THEME.DARK);
  assert.equal(store.now().zoom, 150);
});
