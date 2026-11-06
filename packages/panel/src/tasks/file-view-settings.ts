/**
 * file-view-settings.ts -- how every File tab draws its lines, numbered or not and wrapped or scrolling sideways, and every diff as a review tool's diff settings say: our own app settings, read and written as any other.
 *
 * Each is an app setting (`@repo/settings`'s `APP_SETTING_SCHEMA`, under
 * Settings › Appearance › Diffs), stored in the app's settings file and carried
 * to every window on the settings document, so a change in one File tab,
 * diff, popover, or Settings row is drawn at once in every other, as an
 * editor's view settings are. A File tab follows the numbers and wrap, and
 * every diff (`file-diff.tsx`) follows them and the rest of stage-cli's diff
 * settings: its layout, how a changed line is marked and what of it is,
 * whether changed lines are tinted, each appearance's syntax theme, its
 * type, size, line height, and ligatures, and whether review comments on
 * their lines stand minimized. Until the first document arrives each stands
 * at its default. A change is written through the one settings write
 * (`settingMutation`), a row's through a mutation of its own whose answer it
 * reads to say a refusal, as a Settings row does (`row-write.ts`); while any
 * is out the setting is drawn as written in every File tab, diff, and menu
 * of the window, read from the window's mutations (`useMutationState`), so
 * a second press before the document comes back reads the first rather than
 * undoing nothing, as the zoom keys step from the size they last asked for.
 */

import type { AppStateSnapshot } from "@repo/host/app-state";
import { APP_SETTING_DEFAULTS, type AppSettingField, type AppSettingValue } from "@repo/settings";
import type { AppSettingsView, SettingsUpdateResult } from "@repo/settings/wire";
import { type Mutation, useMutation, useMutationState, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { type SettingWrite, settingMutation } from "../act-mutations.js";
import { appStateQuery, selectAppSettingsView } from "../use-app-state.js";

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

/**
 * The settings as the document holds them for a File tab or diff, which
 * Query's structural sharing hands back as the same object until one of
 * their own fields moves, so a write to another setting draws none of them.
 */
const selectStoredFileView = (state: AppStateSnapshot): FileViewSettings =>
  settingsOf(selectAppSettingsView(state));

/** The settings code and diffs are drawn by, and the door that writes one for every window, answering the write's own answer. */
export interface FileViewSettingsControl {
  readonly settings: FileViewSettings;
  readonly change: <Field extends FileViewField>(
    field: Field,
    value: AppSettingValue<Field>,
  ) => void;
}

/** Whether `field` is one code and diffs are drawn by. */
function isFileViewField(field: AppSettingField): field is FileViewField {
  return field in DEFAULT_SETTINGS;
}

/** `stored` with each write still out drawn as written, the latest of a field's last. */
function withWrites(
  stored: FileViewSettings,
  out: readonly (SettingWrite | undefined)[],
): FileViewSettings {
  let settings = stored;
  for (const write of out) {
    if (write !== undefined && isFileViewField(write.field)) {
      settings = { ...settings, [write.field]: write.value };
    }
  }
  return settings;
}

export function useFileViewSettings(): FileViewSettingsControl {
  const stored =
    useQuery({ ...appStateQuery, select: selectStoredFileView }).data ?? DEFAULT_SETTINGS;
  const { mutate } = useMutation(settingMutation());
  // Note that every settings write still out, this hook's or a row's, is read from the window's mutations, as the Optimistic Updates guide reads another component's.
  const out = useMutationState<
    SettingWrite | undefined,
    Mutation<SettingsUpdateResult, Error, SettingWrite>
  >({
    filters: { mutationKey: settingMutation().mutationKey, status: "pending" },
    select: (mutation) => mutation.state.variables,
  });
  const settings = useMemo(() => withWrites(stored, out), [stored, out]);
  const change = useCallback(
    <Field extends FileViewField>(field: Field, value: AppSettingValue<Field>) =>
      mutate({ field, value }),
    [mutate],
  );
  return { settings, change };
}
