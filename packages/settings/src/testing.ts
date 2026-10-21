import { LIVE_VOICE } from "@luke/live";
import { type Experiment, type ExperimentChoices, NO_EXPERIMENTS } from "./experiments.js";
import {
  APP_SETTING_DEFAULTS,
  APP_SETTING_FIELDS,
  type StoredAppSettings,
} from "./schema-access.js";
import type { AppSettings, AppSettingsView, RuntimeStatus } from "./wire.js";

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
      duckOtherMedia: true,
      voiceAvailable: false,
      preferBuiltInMicrophone: false,
      experiments: NO_EXPERIMENTS,
    },
    overrides,
  );
}

/** Turns a renderer view back into wire state for settings-update fixtures. */
export function appSettingsWire(settings: AppSettingsView): AppSettings {
  const storedEntries = Object.fromEntries(
    APP_SETTING_FIELDS.map((field) => [field, settings[field]]),
  );
  // SAFETY: APP_SETTING_FIELDS enumerates every schema-derived stored field exactly once.
  const stored = storedEntries as StoredAppSettings;
  const status: RuntimeStatus = { voiceAvailable: settings.voiceAvailable };
  return { stored, status, experiments: settings.experiments };
}

/**
 * The account's choice with exactly these experiments on and every other
 * off, for a case that draws a gated surface: `settingsView({ experiments:
 * experimentsOn(EXPERIMENT.CHAT) })`.
 */
export function experimentsOn(...experiments: readonly Experiment[]): ExperimentChoices {
  return Object.fromEntries(experiments.map((experiment) => [experiment, true]));
}
