/**
 * file-view-settings.ts -- how every File tab draws its lines, with or without their numbers, wrapped or scrolling sideways, and every diff as a review tool's diff settings say, kept across launches.
 *
 * The choice is the window's own, as the sidebar's fold is
 * (`../desktop/sidebar-collapse.ts`): no other window draws a File tab and
 * main never reads it, so it is kept in the renderer's storage rather than
 * crossing to the settings file. One choice holds for every File tab, and a
 * change in one is drawn at once in every other, as an editor's view
 * settings are.
 *
 * Every diff (`file-diff.tsx`) follows the same numbers and wrap, and the
 * rest of stage-cli's diff settings beside them: its layout, unified or
 * split; how a changed line is marked and what of it is; whether changed
 * lines are tinted; the syntax theme each appearance is coloured in, kept
 * apart; its type, size, line height, and ligatures; and whether review
 * comments drawn on their lines stand minimized. Each defaults to how a
 * diff is drawn today, the File tab's look, and a setting new to Luke to
 * stage-cli's. Each setting is read on its own, so a choice kept before
 * one was offered, or one value that no longer reads, leaves the others as
 * they were kept and that one at its default.
 */

import { Effect, Option, Schema } from "effect";
import { useSyncExternalStore } from "react";
import {
  DIFF_FONT,
  DIFF_FONT_SIZES,
  DIFF_INDICATORS,
  DIFF_LAYOUT,
  DIFF_LINE_HEIGHT,
  DIFF_THEMES,
  INLINE_DIFF,
} from "../diff-view/contract";

/** The storage key the choice is kept under. */
const FILE_VIEW_SETTINGS_KEY = "luke.file-view";

/**
 * How a File tab and a diff draw until told otherwise: numbered and
 * wrapped, a diff unified in the File tab's GitHub themes and type, its
 * changed lines tinted with a bar at their edge and their changed words
 * marked; ligatures off and comments open, as stage-cli starts.
 */
export const DEFAULT_SETTINGS = {
  lineNumbers: true,
  wordWrap: true,
  diffLayout: DIFF_LAYOUT.UNIFIED,
  diffIndicators: DIFF_INDICATORS.BARS,
  inlineDiff: INLINE_DIFF.WORD_ALT,
  diffBackgrounds: true,
  darkTheme: "github-dark-default",
  lightTheme: "github-light-default",
  diffFont: DIFF_FONT.SF_MONO,
  diffFontSize: "11.5",
  diffLineHeight: DIFF_LINE_HEIGHT.NORMAL,
  diffLigatures: false,
  minimizeComments: false,
} as const;

/** A kept setting read on its own: as kept where it reads, its default where it is missing or does not. */
export function keptOr<S extends Schema.Codec<unknown, unknown>>(
  schema: S,
  fallback: S["Type"] & S["Encoded"],
) {
  return schema.pipe(
    Schema.catchDecoding(() => Effect.succeed(Option.some(fallback))),
    Schema.withDecodingDefault(Effect.succeed(fallback)),
  );
}

const fileViewSettingsSchema = Schema.Struct({
  lineNumbers: keptOr(Schema.Boolean, DEFAULT_SETTINGS.lineNumbers),
  wordWrap: keptOr(Schema.Boolean, DEFAULT_SETTINGS.wordWrap),
  diffLayout: keptOr(Schema.Literals(Object.values(DIFF_LAYOUT)), DEFAULT_SETTINGS.diffLayout),
  diffIndicators: keptOr(
    Schema.Literals(Object.values(DIFF_INDICATORS)),
    DEFAULT_SETTINGS.diffIndicators,
  ),
  inlineDiff: keptOr(Schema.Literals(Object.values(INLINE_DIFF)), DEFAULT_SETTINGS.inlineDiff),
  diffBackgrounds: keptOr(Schema.Boolean, DEFAULT_SETTINGS.diffBackgrounds),
  darkTheme: keptOr(
    Schema.Literals(DIFF_THEMES.DARK.map((theme) => theme.id)),
    DEFAULT_SETTINGS.darkTheme,
  ),
  lightTheme: keptOr(
    Schema.Literals(DIFF_THEMES.LIGHT.map((theme) => theme.id)),
    DEFAULT_SETTINGS.lightTheme,
  ),
  diffFont: keptOr(Schema.Literals(Object.values(DIFF_FONT)), DEFAULT_SETTINGS.diffFont),
  diffFontSize: keptOr(Schema.Literals(DIFF_FONT_SIZES), DEFAULT_SETTINGS.diffFontSize),
  diffLineHeight: keptOr(
    Schema.Literals(Object.values(DIFF_LINE_HEIGHT)),
    DEFAULT_SETTINGS.diffLineHeight,
  ),
  diffLigatures: keptOr(Schema.Boolean, DEFAULT_SETTINGS.diffLigatures),
  minimizeComments: keptOr(Schema.Boolean, DEFAULT_SETTINGS.minimizeComments),
});

export type FileViewSettings = typeof fileViewSettingsSchema.Type;

const decodeSettings = Schema.decodeUnknownOption(Schema.fromJsonString(fileViewSettingsSchema));

/**
 * The kept choice, each setting read on its own: one kept and readable as
 * kept, any other at its default, every one at it where nothing is kept,
 * the kept text is no object, or storage refuses the read.
 */
function readSettings(): FileViewSettings {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(FILE_VIEW_SETTINGS_KEY);
  } catch {
    // The defaults stand.
  }
  return Option.getOrElse(decodeSettings(stored), () => DEFAULT_SETTINGS);
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
