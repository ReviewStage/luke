import assert from "node:assert/strict";
import { HOST_CAPABILITY } from "@luke/settings";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { test } from "vitest";
import { DESKTOP_CAPABILITIES } from "#testing/app-state";
import { shownSettingsView } from "./pages";

/**
 * The page Settings shows for the one chosen: a link to a page the platform
 * leaves out lands on Profile, so the title, the reset, the copied link, and
 * the history name the page on screen; a page the platform offers is shown.
 */

test("a link to the Voice page shows Voice on the desktop and Profile on a platform without voice", () => {
  const withoutVoice = DESKTOP_CAPABILITIES.filter((each) => each !== HOST_CAPABILITY.VOICE);

  assert.equal(shownSettingsView(SETTINGS_VIEW.VOICE, DESKTOP_CAPABILITIES), SETTINGS_VIEW.VOICE);
  assert.equal(shownSettingsView(SETTINGS_VIEW.VOICE, withoutVoice), SETTINGS_VIEW.ACCOUNT);
  assert.equal(shownSettingsView(SETTINGS_VIEW.APPEARANCE, []), SETTINGS_VIEW.APPEARANCE);
});
