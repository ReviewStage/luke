import type { AppStateSnapshot } from "@repo/host/app-state";
import { APP_SETTING_DEFAULTS, type AppSettingField, type AppSettingValue } from "@repo/settings";
import type { AppSettingsView, SettingsUpdateResult } from "@repo/settings/wire";
import { type Mutation, useMutation, useMutationState, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { type SettingWrite, settingMutation } from "../act-mutations.js";
import { appStateQuery, selectAppSettingsView } from "../use-app-state.js";

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

const selectStoredFileView = (state: AppStateSnapshot): FileViewSettings =>
  settingsOf(selectAppSettingsView(state));

export interface FileViewSettingsControl {
  readonly settings: FileViewSettings;
  readonly change: <Field extends FileViewField>(
    field: Field,
    value: AppSettingValue<Field>,
  ) => void;
}

function isFileViewField(field: AppSettingField): field is FileViewField {
  return field in DEFAULT_SETTINGS;
}

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
