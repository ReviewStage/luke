import assert from "node:assert/strict";
import { EXPERIMENT, HOST_CAPABILITY, NO_EXPERIMENTS } from "@luke/settings";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { test } from "vitest";
import { DESKTOP_CAPABILITIES } from "../testing/app-state.js";
import { shownSettingsView } from "./settings-rows.js";

/**
 * The page Settings shows for the one chosen: a link to a page the platform
 * leaves out lands on Profile, so the title, the reset, the copied link, and
 * the history name the page on screen; a page the platform offers is shown,
 * and a page an experiment holds only while the account has it on.
 */

test("a link to the Keyboard shortcuts page shows it on the desktop and Profile on a platform without the desktop app", () => {
  const browser = DESKTOP_CAPABILITIES.filter((each) => each !== HOST_CAPABILITY.DESKTOP_APP);

  assert.equal(
    shownSettingsView(SETTINGS_VIEW.SHORTCUTS, DESKTOP_CAPABILITIES, NO_EXPERIMENTS),
    SETTINGS_VIEW.SHORTCUTS,
  );
  assert.equal(
    shownSettingsView(SETTINGS_VIEW.SHORTCUTS, browser, NO_EXPERIMENTS),
    SETTINGS_VIEW.ACCOUNT,
  );
  assert.equal(
    shownSettingsView(SETTINGS_VIEW.APPEARANCE, [], NO_EXPERIMENTS),
    SETTINGS_VIEW.APPEARANCE,
  );
});

test.each([
  { name: "Memory", view: SETTINGS_VIEW.MEMORY, experiment: EXPERIMENT.MEMORY },
  { name: "Machines", view: SETTINGS_VIEW.MACHINES, experiment: EXPERIMENT.LOCAL_AGENTS },
])(
  "a link to the $name page shows it only while the account has its experiment on, and Profile otherwise",
  ({ view, experiment }) => {
    assert.equal(shownSettingsView(view, DESKTOP_CAPABILITIES, { [experiment]: true }), view);
    assert.equal(
      shownSettingsView(view, DESKTOP_CAPABILITIES, NO_EXPERIMENTS),
      SETTINGS_VIEW.ACCOUNT,
    );
    assert.equal(
      shownSettingsView(view, DESKTOP_CAPABILITIES, { [experiment]: false }),
      SETTINGS_VIEW.ACCOUNT,
    );
  },
);
