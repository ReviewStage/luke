import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { Predicate, Schema } from "effect";
import type { ExperimentChoices } from "./experiments.js";
import { APP_SETTING_DEFAULTS, type StoredAppSettings } from "./schema-access.js";
import type { RuntimeStatus } from "./status.js";

export type { SettingsResetScope } from "./schema.js";
export { SETTINGS_RESET_SCOPE } from "./schema.js";
export type {
  AppSettingField,
  AppSettingValue,
} from "./schema-access.js";
export type { RuntimeStatus } from "./status.js";

/** Renderer-safe settings. Credentials are never sent to a renderer. */
export interface AppSettings {
  stored: StoredAppSettings;
  status: RuntimeStatus;
  /**
   * The experiments the signed-in account turned on or back off, as the
   * service last answered them; none while signed out. The account's on the
   * service rather than a stored setting, carried here so every window and
   * the main process read them off the one document the settings ride.
   */
  experiments: ExperimentChoices;
}

/** A renderer-local view over the two disjoint halves of the settings wire. */
type ResolvedSettingField =
  | "voice"
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
  | "linkOpen";
export type AppSettingsView = Omit<StoredAppSettings, ResolvedSettingField> & {
  [Field in ResolvedSettingField]-?: NonNullable<StoredAppSettings[Field]>;
} & RuntimeStatus & { experiments: ExperimentChoices };

export function appSettingsView(settings: AppSettings): AppSettingsView {
  return {
    ...settings.stored,
    ...settings.status,
    experiments: settings.experiments,
    voice: settings.stored.voice ?? APP_SETTING_DEFAULTS.voice,
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
  };
}

/** Every settings write returns the canonical action result and the latest stored snapshot. */
export type SettingsUpdateResult = ActionResult & {
  settings: AppSettings;
  /** Present only when the canonical action result is rejected or unsupported. */
  reason?: string;
};

/**
 * A settings document as a settings write's answer carries it: read for its
 * three halves and passed on whole, as that answer always crossed. Each
 * stored field is the settings store's to check, which checked it before
 * answering, so nothing here reads one, and nothing here drops one.
 */
const appSettingsSchema = Schema.declare(
  (value): value is AppSettings =>
    Predicate.isObject(value) &&
    Predicate.isObject(value.stored) &&
    Predicate.isObject(value.status) &&
    Predicate.isObject(value.experiments),
);

/** A settings write's answer, the type above as a schema: its action result, the settings as they then stand, and why where it did not land. */
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
