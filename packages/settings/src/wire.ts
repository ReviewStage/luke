import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { Predicate, Schema } from "effect";
import type { ExperimentChoices } from "./experiments.js";
import { APP_SETTING_DEFAULTS, type StoredAppSettings } from "./schema-access.js";

export type { SettingsResetScope } from "./schema.js";
export { SETTINGS_RESET_SCOPE } from "./schema.js";
export type {
  AppSettingField,
  AppSettingValue,
} from "./schema-access.js";

export interface AppSettings {
  stored: StoredAppSettings;
  experiments: ExperimentChoices;
  accountRead: boolean;
}

type ResolvedSettingField =
  | "theme"
  | "zoom"
  | "diffLayout"
  | "diffIndicators"
  | "inlineDiff"
  | "diffDarkTheme"
  | "diffLightTheme"
  | "diffFont"
  | "diffFontSize"
  | "diffLineHeight"
  | "linkOpen"
  | "commitAuthor";
export type AppSettingsView = Omit<StoredAppSettings, ResolvedSettingField> & {
  [Field in ResolvedSettingField]-?: NonNullable<StoredAppSettings[Field]>;
} & { experiments: ExperimentChoices; accountRead: boolean };

export function appSettingsView(settings: AppSettings): AppSettingsView {
  return {
    ...settings.stored,
    experiments: settings.experiments,
    accountRead: settings.accountRead,
    theme: settings.stored.theme ?? APP_SETTING_DEFAULTS.theme,
    zoom: settings.stored.zoom ?? APP_SETTING_DEFAULTS.zoom,
    diffLayout: settings.stored.diffLayout ?? APP_SETTING_DEFAULTS.diffLayout,
    diffIndicators: settings.stored.diffIndicators ?? APP_SETTING_DEFAULTS.diffIndicators,
    inlineDiff: settings.stored.inlineDiff ?? APP_SETTING_DEFAULTS.inlineDiff,
    diffDarkTheme: settings.stored.diffDarkTheme ?? APP_SETTING_DEFAULTS.diffDarkTheme,
    diffLightTheme: settings.stored.diffLightTheme ?? APP_SETTING_DEFAULTS.diffLightTheme,
    diffFont: settings.stored.diffFont ?? APP_SETTING_DEFAULTS.diffFont,
    diffFontSize: settings.stored.diffFontSize ?? APP_SETTING_DEFAULTS.diffFontSize,
    diffLineHeight: settings.stored.diffLineHeight ?? APP_SETTING_DEFAULTS.diffLineHeight,
    linkOpen: settings.stored.linkOpen ?? APP_SETTING_DEFAULTS.linkOpen,
    commitAuthor: settings.stored.commitAuthor ?? APP_SETTING_DEFAULTS.commitAuthor,
  };
}

export type SettingsUpdateResult = ActionResult & {
  settings: AppSettings;
  reason?: string;
};

const appSettingsSchema = Schema.declare(
  (value): value is AppSettings =>
    Predicate.isObject(value) &&
    Predicate.isObject(value.stored) &&
    Predicate.isObject(value.experiments),
);

export const settingsUpdateResultSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal(ACTION_RESULT_STATUS.ACCEPTED),
    settings: appSettingsSchema,
    reason: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    status: Schema.Literal(ACTION_RESULT_STATUS.REJECTED),
    settings: appSettingsSchema,
    reason: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal(ACTION_RESULT_STATUS.UNSUPPORTED),
    settings: appSettingsSchema,
    reason: Schema.String,
  }),
]);
