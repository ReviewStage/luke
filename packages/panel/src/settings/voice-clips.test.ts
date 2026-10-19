// voice-clips.test.ts -- every voice Settings offers is heard from a clip the panel's build ships.

import assert from "node:assert/strict";
import { statSync } from "node:fs";
import path from "node:path";
import { panelStaticDirectories } from "@luke/panel/build-table";
import { SETTING_SECTION, SETTINGS_PAGE, settingRowsForPage } from "@luke/settings";
import { settingsView } from "@luke/settings/testing";
import { test } from "vitest";
import { DESKTOP_CAPABILITIES } from "../testing/app-state.js";

/**
 * The Voice row names each voice's clip by its path under the asset base,
 * and the build copies the panel's static folders there, so a voice the Live
 * vocabulary gains without a recording (`tools/voice-samples`)
 * fails here rather than as a play button that plays nothing.
 */

/** The file the build serves at a path under the asset base, if any of its static folders holds it. */
function servedFile(assetPath: string): string | undefined {
  for (const { from, to } of panelStaticDirectories()) {
    if (!assetPath.startsWith(`${to}/`)) continue;
    const file = path.join(from, assetPath.slice(to.length + 1));
    if (statSync(file, { throwIfNoEntry: false })?.isFile()) return file;
  }
  return undefined;
}

test("every voice the Voice row offers has a clip the build serves", () => {
  const view = {
    settings: settingsView({ voiceAvailable: true }),
    voiceControlsDrawn: true,
    accountDrawn: true,
    capabilities: DESKTOP_CAPABILITIES,
  };
  const voice =
    settingRowsForPage(SETTINGS_PAGE.VOICE, SETTING_SECTION.CONTROLS, view).find(
      (row) => row.field === "voice",
    ) ?? assert.fail("the Voice page draws the voice");
  const options = voice.control?.options ?? assert.fail("the voice is a choice");
  assert.ok(options.length > 0);

  const unheard = options.filter(
    (option) => option.sample === undefined || servedFile(option.sample) === undefined,
  );
  assert.deepEqual(
    unheard.map((option) => option.value),
    [],
  );
});
