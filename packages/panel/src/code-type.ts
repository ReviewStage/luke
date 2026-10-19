/**
 * code-type.ts -- the type code is set in, as View settings sets it: each font's stack, each line height's ratio, and the font features ligatures turn, one table for a diff and a File tab's lines alike.
 *
 * A diff sets these on its host for its shadow root (`diff-view/index.ts`),
 * and a run of lines on its own box (`tasks/code-lines.tsx`), so a setting
 * reads the same in every place code is drawn.
 */

import { DIFF_FONT, DIFF_LINE_HEIGHT } from "@luke/settings/diff-view";
import type { DiffLook } from "./diff-view/contract.js";

/** Each font's stack, ending in the window's own code type should the Mac lack it. */
export const FONT_STACK = {
  [DIFF_FONT.SF_MONO]: "var(--luke-font-mono)",
  [DIFF_FONT.MENLO]: "Menlo, var(--luke-font-mono)",
  [DIFF_FONT.MONACO]: "Monaco, var(--luke-font-mono)",
  [DIFF_FONT.COURIER_NEW]: '"Courier New", var(--luke-font-mono)',
  [DIFF_FONT.ANDALE_MONO]: '"Andale Mono", var(--luke-font-mono)',
} as const satisfies Record<DiffLook["font"], string>;

/** Each line height as a ratio of the type's size, so a line grows with its type; the File tab's 1.6 at normal. */
export const LINE_HEIGHT_RATIO = {
  [DIFF_LINE_HEIGHT.COMPACT]: "1.45",
  [DIFF_LINE_HEIGHT.NORMAL]: "1.6",
  [DIFF_LINE_HEIGHT.SPACIOUS]: "1.85",
} as const satisfies Record<DiffLook["lineHeight"], string>;

/** The font features ligatures turn on or off. */
export const LIGATURES = { ON: "'liga' 1, 'calt' 1", OFF: "'liga' 0, 'calt' 0" } as const;

/** The type a run of code is set in: its font, its size in pixels, its line height, and whether its ligatures join. */
export type CodeType = Pick<DiffLook, "font" | "fontSize" | "lineHeight" | "ligatures">;
