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
 * (`useAct`'s `updateSetting`), whose answer a control reads to say a
 * refusal, as a Settings row does; while it is out the setting is drawn as
 * written, so a second press before the document comes back reads the
 * first rather than undoing nothing, as the zoom keys step from the size
 * they last asked for.
 */

import { APP_SETTING_DEFAULTS, type AppSettingField, type AppSettingValue } from "@luke/settings";
import { type AppSettingsView, appSettingsView } from "@luke/settings/wire";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useAct } from "../act.js";
import { useAppState } from "../use-app-state.js";

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

/** The settings code and diffs are drawn by, and the door that writes one for every window, answering the write's own answer. */
export interface FileViewSettingsControl {
  readonly settings: FileViewSettings;
  readonly change: <Field extends FileViewField>(
    field: Field,
    value: AppSettingValue<Field>,
  ) => Promise<ActionResult>;
}

/**
 * The writes still out, by field, as this window drew them: one run for
 * every File tab, diff, and menu in the window, so a press in one is drawn
 * at once in all of them and read by the next press anywhere.
 */
let pending: Partial<FileViewSettings> = {};
const pendingListeners = new Set<() => void>();
/** Each field's latest write, by the number it was asked under, which alone may clear what is drawn for it. */
const latestWrite = new Map<FileViewField, number>();
let writesAsked = 0;

/** What a control is told where a write was refused before it reached the store. */
const REFUSED = "Could not save that setting on this system.";

function subscribePending(listener: () => void): () => void {
  pendingListeners.add(listener);
  return () => pendingListeners.delete(listener);
}

function pendingNow(): Partial<FileViewSettings> {
  return pending;
}

/** Sets the writes still out, telling every reader. */
function setPending(next: Partial<FileViewSettings>): void {
  pending = next;
  for (const listener of pendingListeners) listener();
}

/** The writes still out, without the one given. */
function without(
  writes: Partial<FileViewSettings>,
  field: FileViewField,
): Partial<FileViewSettings> {
  const next = { ...writes };
  delete next[field];
  return next;
}

export function useFileViewSettings(): FileViewSettingsControl {
  const stored = useAppState()?.settings;
  const { updateSetting } = useAct();
  const out = useSyncExternalStore(subscribePending, pendingNow);
  const settings = useMemo(
    () => ({
      ...settingsOf(stored === undefined ? undefined : appSettingsView(stored)),
      ...out,
    }),
    [stored, out],
  );
  const change = useCallback(
    <Field extends FileViewField>(field: Field, value: AppSettingValue<Field>) => {
      writesAsked += 1;
      const asked = writesAsked;
      latestWrite.set(field, asked);
      setPending({ ...pending, [field]: value });
      // The write is drawn as written until the field's latest write is answered, then as the document holds it.
      const settle = () => {
        if (latestWrite.get(field) !== asked) return;
        latestWrite.delete(field);
        setPending(without(pending, field));
      };
      // Note that a refusal is answered as a rejected result, as a control reads one, rather than thrown.
      const write: Promise<ActionResult> = updateSetting(field, value).then(
        (result) => result,
        () => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: REFUSED }),
      );
      return write.finally(settle);
    },
    [updateSetting],
  );
  return { settings, change };
}
