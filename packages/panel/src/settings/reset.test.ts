// @vitest-environment jsdom

import assert from "node:assert/strict";
import { THEME } from "@luke/settings";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { appSettingsWire, settingsView } from "@luke/settings/testing";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { pageResetControl } from "./reset.js";
import type { SettingsWrites } from "./writes.js";

/**
 * reset.test.ts -- a page's reset that the store refuses says why in a
 * failure's toast, announced as an alert, and the reset stands pressable
 * again.
 */

const REFUSED = "The settings could not be reset. Try again.";

const roots: Root[] = [];

afterEach(() => {
  for (const each of roots.splice(0)) act(() => each.unmount());
  document.body.innerHTML = "";
});

/** The page's settings as they stand: the theme moved off its default, so the page offers its reset. */
const settings = settingsView({ theme: THEME.DARK });

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
        pageResetControl(SETTINGS_VIEW.APPEARANCE, settings, writes),
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
