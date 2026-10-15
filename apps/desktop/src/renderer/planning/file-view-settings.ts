/**
 * file-view-settings.ts -- how every File tab draws its lines: with or without their numbers, wrapped or scrolling sideways, and a diff's in one column or side by side, its changed words marked or not, kept across launches.
 *
 * The choice is the window's own, as the sidebar's fold is
 * (`../desktop/sidebar-collapse.ts`): no other window draws a File tab and
 * main never reads it, so it is kept in the renderer's storage rather than
 * crossing to the settings file. One choice holds for every File tab, and a
 * change in one is drawn at once in every other, as an editor's view
 * settings are.
 *
 * A Changes tab's diff follows two more, as a review tool's diff settings
 * do: whether it is drawn unified or split, the old side beside the new,
 * and whether a changed line marks the words it changed. A choice kept
 * before those two were offered reads with them at their defaults, so the
 * first two are never lost to a launch.
 */

import { Option, Schema } from "effect";
import { useSyncExternalStore } from "react";

/** The storage key the choice is kept under. */
const FILE_VIEW_SETTINGS_KEY = "luke.file-view";

/** How a Changes tab lays out its diff: one column of lines, or the old side beside the new. */
export const DIFF_LAYOUT = {
  UNIFIED: "unified",
  SPLIT: "split",
} as const;

const fileViewSettingsSchema = Schema.Struct({
  lineNumbers: Schema.Boolean,
  wordWrap: Schema.Boolean,
  diffLayout: Schema.optionalKey(Schema.Literals(Object.values(DIFF_LAYOUT))),
  changedWords: Schema.optionalKey(Schema.Boolean),
});

type FileViewSettings = Required<typeof fileViewSettingsSchema.Type>;

/** How a File tab draws until it is told otherwise: numbered and wrapped, as it always has been, a diff unified with its changed words marked. */
const DEFAULT_SETTINGS: FileViewSettings = {
  lineNumbers: true,
  wordWrap: true,
  diffLayout: DIFF_LAYOUT.UNIFIED,
  changedWords: true,
};

const decodeSettings = Schema.decodeUnknownOption(Schema.fromJsonString(fileViewSettingsSchema));

/** The kept choice, or the default when there is none, it no longer reads, or storage refuses the read. */
function readSettings(): FileViewSettings {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(FILE_VIEW_SETTINGS_KEY);
  } catch {
    // The default stands.
  }
  return { ...DEFAULT_SETTINGS, ...Option.getOrElse(decodeSettings(stored), () => ({})) };
}

let current: FileViewSettings | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): FileViewSettings {
  current ??= readSettings();
  return current;
}

/** Changes one setting for every File tab, kept where storage takes it. */
function changeSettings(change: Partial<FileViewSettings>): void {
  current = { ...snapshot(), ...change };
  try {
    window.localStorage.setItem(FILE_VIEW_SETTINGS_KEY, JSON.stringify(current));
  } catch {
    // The choice holds for this window's life.
  }
  for (const listener of listeners) listener();
}

/** The File tabs' settings, and the door that changes them for all of them. */
export interface FileViewSettingsControl {
  readonly settings: FileViewSettings;
  readonly change: (change: Partial<FileViewSettings>) => void;
}

export function useFileViewSettings(): FileViewSettingsControl {
  const settings = useSyncExternalStore(subscribe, snapshot);
  return { settings, change: changeSettings };
}
