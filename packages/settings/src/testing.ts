import { LIVE_VOICE } from "@luke/live";
import { APP_SETTING_DEFAULTS } from "./schema-access.js";
import type { AppSettingsView } from "./wire.js";

/**
 * What a case may move, including back to a field's stored default of nothing:
 * the view resolves `voice` to a value, and a
 * case that moves one to the absence the schema declares says so with
 * `undefined`.
 */
type SettingsViewOverrides = {
  [Field in keyof AppSettingsView]?: AppSettingsView[Field] | undefined;
};

/**
 * A settings snapshot with every member at a stated value, so a test is told
 * apart from the next only by what it moves.
 */
export function settingsView(overrides: SettingsViewOverrides = {}): AppSettingsView {
  // Object.assign rather than a spread: spreading a Partial marks every key it
  // could carry optional, and the result stops being an AppSettingsView.
  return Object.assign<AppSettingsView, SettingsViewOverrides>(
    {
      ...APP_SETTING_DEFAULTS,
      voice: LIVE_VOICE.CEDAR,
      voiceCaptions: false,
      duckOtherMedia: true,
      voiceAvailable: false,
      preferBuiltInMicrophone: false,
    },
    overrides,
  );
}
