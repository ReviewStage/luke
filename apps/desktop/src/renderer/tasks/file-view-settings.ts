/**
 * file-view-settings.ts -- how every File tab draws its lines: with or without their numbers, wrapped or scrolling sideways, and a diff's unified or split, its changed words marked or not, kept across launches.
 *
 * The choice is the window's own, as the sidebar's fold is
 * (`../desktop/sidebar-collapse.ts`): no other window draws a File tab and
 * main never reads it, so it is kept in the renderer's storage rather than
 * crossing to the settings file. One choice holds for every File tab, and a
 * change in one is drawn at once in every other, as an editor's view
 * settings are.
 *
 * The Files changed view's diff follows two more, as a review tool's diff
 * settings do: whether it is laid out unified or split, the old side beside
 * the new, and whether a changed line marks the words it changed. Each
 * setting is read on its own, so a choice kept before one was offered, or
 * one value that no longer reads, leaves the others as they were kept and
 * that one at its default.
 */

import { Effect, Option, Schema } from "effect";
import { useSyncExternalStore } from "react";
import { DIFF_LAYOUT } from "../diff-view/contract";

/** The storage key the choice is kept under. */
const FILE_VIEW_SETTINGS_KEY = "luke.file-view";

/** How a diff may be laid out, as kept. */
const diffLayoutSchema = Schema.Literals(Object.values(DIFF_LAYOUT));

/** How a File tab draws until it is told otherwise: numbered and wrapped, as it always has been, a diff unified with its changed words marked. */
const DEFAULT_SETTINGS = {
  lineNumbers: true,
  wordWrap: true,
  diffLayout: DIFF_LAYOUT.UNIFIED,
  changedWords: true,
} as const;

/** A kept setting read on its own: as kept where it reads, its default where it is missing or does not. */
function keptOr<S extends Schema.Codec<unknown, unknown>>(
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
  diffLayout: keptOr(diffLayoutSchema, DEFAULT_SETTINGS.diffLayout),
  changedWords: keptOr(Schema.Boolean, DEFAULT_SETTINGS.changedWords),
});

type FileViewSettings = typeof fileViewSettingsSchema.Type;

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
