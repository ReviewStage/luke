import { LIVE_VOICE } from "@sidecar/live";
import { APP_SETTING_DEFAULTS } from "./schema-access.js";
import type { SettingsVisibility } from "./schema-types.js";
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
      showInDock: false,
      voice: LIVE_VOICE.CEDAR,
      voiceCaptions: false,
      duckOtherMedia: true,
      voiceAvailable: false,
      preferBuiltInMicrophone: false,
    },
    overrides,
  );
}

/**
 * What a row's own condition is judged from, at a stated resting state: no
 * account and no voice controls, so a test says which of those it is about by
 * moving it.
 */
export function settingsVisibility(
  overrides: Partial<Omit<SettingsVisibility, "settings">> & {
    settings?: Partial<AppSettingsView>;
  } = {},
): SettingsVisibility & { settings: AppSettingsView } {
  const { settings, ...rest } = overrides;
  return {
    voiceControlsDrawn: false,
    accountDrawn: false,
    ...rest,
    settings: settingsView(settings),
  };
}
