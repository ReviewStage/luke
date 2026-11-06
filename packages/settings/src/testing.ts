import { type Experiment, type ExperimentChoices, NO_EXPERIMENTS } from "./experiments.js";
import {
  APP_SETTING_DEFAULTS,
  APP_SETTING_FIELDS,
  type StoredAppSettings,
} from "./schema-access.js";
import type { AppSettings, AppSettingsView } from "./wire.js";

type SettingsViewOverrides = {
  [Field in keyof AppSettingsView]?: AppSettingsView[Field] | undefined;
};

export function settingsView(overrides: SettingsViewOverrides = {}): AppSettingsView {
  return Object.assign<AppSettingsView, SettingsViewOverrides>(
    {
      ...APP_SETTING_DEFAULTS,
      preferBuiltInMicrophone: false,
      experiments: NO_EXPERIMENTS,
      accountRead: true,
    },
    overrides,
  );
}

export function appSettingsWire(settings: AppSettingsView): AppSettings {
  const storedEntries = Object.fromEntries(
    APP_SETTING_FIELDS.map((field) => [field, settings[field]]),
  );
  const stored = storedEntries as StoredAppSettings;
  return { stored, experiments: settings.experiments, accountRead: settings.accountRead };
}

export function experimentsOn(...experiments: readonly Experiment[]): ExperimentChoices {
  return Object.fromEntries(experiments.map((experiment) => [experiment, true]));
}
