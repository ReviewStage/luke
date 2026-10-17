/**
 * file-view-settings.ts -- how every File tab draws its lines, numbered or not and wrapped or scrolling sideways, and every diff as a review tool's diff settings say: Luke's own app settings, read and written as any other.
 *
 * Each is an app setting (`@luke/settings`'s `APP_SETTING_SCHEMA`, under
 * Settings › Appearance › Diffs), stored in Luke's settings file and carried
 * to every window on the settings document, so a change in one File tab,
 * diff, popover, or Settings row is drawn at once in every other, as an
 * editor's view settings are. A File tab follows the numbers and wrap, and
 * every diff (`file-diff.tsx`) follows them and the rest of stage-cli's diff
 * settings: its layout, how a changed line is marked and what of it is,
 * whether changed lines are tinted, each appearance's syntax theme, its
 * type, size, line height, and ligatures, and whether review comments on
 * their lines stand minimized. Until the first document arrives each stands
 * at its default. A change is written through the one settings write
 * (`useAct`'s `updateSetting`) and drawn when the document comes back.
 */

import { APP_SETTING_DEFAULTS, type AppSettingField, type AppSettingValue } from "@luke/settings";
import { type AppSettingsView, appSettingsView } from "@luke/settings/wire";
import { useCallback, useMemo } from "react";
import { useAct } from "../act";
import { useAppState } from "../use-app-state";

/** The settings code and diffs are drawn by, by their fields in the settings schema. */
type FileViewField = Extract<
  AppSettingField,
  | "lineNumbers"
  | "wordWrap"
  | "diffLayout"
  | "diffIndicators"
  | "inlineDiff"
  | "diffBackgrounds"
  | "diffDarkTheme"
  | "diffLightTheme"
  | "diffFont"
  | "diffFontSize"
  | "diffLineHeight"
  | "diffLigatures"
  | "diffMinimizeComments"
>;

export type FileViewSettings = Pick<AppSettingsView, FileViewField>;

/** How code and diffs are drawn until told otherwise, each setting's own default. */
export const DEFAULT_SETTINGS: FileViewSettings = {
  lineNumbers: APP_SETTING_DEFAULTS.lineNumbers,
  wordWrap: APP_SETTING_DEFAULTS.wordWrap,
  diffLayout: APP_SETTING_DEFAULTS.diffLayout,
  diffIndicators: APP_SETTING_DEFAULTS.diffIndicators,
  inlineDiff: APP_SETTING_DEFAULTS.inlineDiff,
  diffBackgrounds: APP_SETTING_DEFAULTS.diffBackgrounds,
  diffDarkTheme: APP_SETTING_DEFAULTS.diffDarkTheme,
  diffLightTheme: APP_SETTING_DEFAULTS.diffLightTheme,
  diffFont: APP_SETTING_DEFAULTS.diffFont,
  diffFontSize: APP_SETTING_DEFAULTS.diffFontSize,
  diffLineHeight: APP_SETTING_DEFAULTS.diffLineHeight,
  diffLigatures: APP_SETTING_DEFAULTS.diffLigatures,
  diffMinimizeComments: APP_SETTING_DEFAULTS.diffMinimizeComments,
};

/** The settings as the document holds them, each at its default before the first document arrives. */
function settingsOf(view: AppSettingsView | undefined): FileViewSettings {
  if (view === undefined) return DEFAULT_SETTINGS;
  return {
    lineNumbers: view.lineNumbers,
    wordWrap: view.wordWrap,
    diffLayout: view.diffLayout,
    diffIndicators: view.diffIndicators,
    inlineDiff: view.inlineDiff,
    diffBackgrounds: view.diffBackgrounds,
    diffDarkTheme: view.diffDarkTheme,
    diffLightTheme: view.diffLightTheme,
    diffFont: view.diffFont,
    diffFontSize: view.diffFontSize,
    diffLineHeight: view.diffLineHeight,
    diffLigatures: view.diffLigatures,
    diffMinimizeComments: view.diffMinimizeComments,
  };
}

/** The settings code and diffs are drawn by, and the door that writes one for every window. */
export interface FileViewSettingsControl {
  readonly settings: FileViewSettings;
  readonly change: <Field extends FileViewField>(
    field: Field,
    value: AppSettingValue<Field>,
  ) => void;
}

export function useFileViewSettings(): FileViewSettingsControl {
  const stored = useAppState()?.settings;
  const { updateSetting } = useAct();
  const settings = useMemo(
    () => settingsOf(stored === undefined ? undefined : appSettingsView(stored)),
    [stored],
  );
  const change = useCallback(
    <Field extends FileViewField>(field: Field, value: AppSettingValue<Field>) => {
      // Note that a refused write leaves the setting as the document holds it, which is what stays drawn.
      updateSetting(field, value).catch(() => undefined);
    },
    [updateSetting],
  );
  return { settings, change };
}
