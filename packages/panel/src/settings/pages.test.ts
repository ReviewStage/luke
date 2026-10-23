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

test("a link to the Voice page shows Voice on the desktop and Profile on a platform without voice", () => {
  const withoutVoice = DESKTOP_CAPABILITIES.filter((each) => each !== HOST_CAPABILITY.VOICE);

  assert.equal(
    shownSettingsView(SETTINGS_VIEW.VOICE, DESKTOP_CAPABILITIES, NO_EXPERIMENTS),
    SETTINGS_VIEW.VOICE,
  );
  assert.equal(
    shownSettingsView(SETTINGS_VIEW.VOICE, withoutVoice, NO_EXPERIMENTS),
    SETTINGS_VIEW.ACCOUNT,
  );
  assert.equal(
    shownSettingsView(SETTINGS_VIEW.APPEARANCE, [], NO_EXPERIMENTS),
    SETTINGS_VIEW.APPEARANCE,
  );
});

test("a link to the Memory page shows Memory only while the account has the Memory experiment on, and Profile otherwise", () => {
  const memoryOn = { [EXPERIMENT.MEMORY]: true };

  assert.equal(
    shownSettingsView(SETTINGS_VIEW.MEMORY, DESKTOP_CAPABILITIES, memoryOn),
    SETTINGS_VIEW.MEMORY,
  );
  assert.equal(
    shownSettingsView(SETTINGS_VIEW.MEMORY, DESKTOP_CAPABILITIES, NO_EXPERIMENTS),
    SETTINGS_VIEW.ACCOUNT,
  );
  assert.equal(
    shownSettingsView(SETTINGS_VIEW.MEMORY, DESKTOP_CAPABILITIES, { [EXPERIMENT.MEMORY]: false }),
    SETTINGS_VIEW.ACCOUNT,
  );
});
