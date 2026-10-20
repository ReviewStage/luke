// @vitest-environment jsdom

import assert from "node:assert/strict";
import { HOST_CAPABILITY, type HostCapability, THEME } from "@luke/settings";
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
 * again; a page offers its reset only for a change to a row it draws.
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
function rowsOn(shown: typeof settings, capabilities: readonly HostCapability[]) {
  return { settings: shown, voiceControlsDrawn: true, accountDrawn: true, capabilities };
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
