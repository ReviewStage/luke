import { DIFF_FONT, DIFF_LINE_HEIGHT } from "@repo/settings/diff-view";
import type { DiffLook } from "./diff-view/contract.js";

export const FONT_STACK = {
  [DIFF_FONT.SF_MONO]: "var(--ui-font-mono)",
  [DIFF_FONT.MENLO]: "Menlo, var(--ui-font-mono)",
  [DIFF_FONT.MONACO]: "Monaco, var(--ui-font-mono)",
  [DIFF_FONT.COURIER_NEW]: '"Courier New", var(--ui-font-mono)',
  [DIFF_FONT.ANDALE_MONO]: '"Andale Mono", var(--ui-font-mono)',
} as const satisfies Record<DiffLook["font"], string>;

export const LINE_HEIGHT_RATIO = {
  [DIFF_LINE_HEIGHT.COMPACT]: "1.45",
  [DIFF_LINE_HEIGHT.NORMAL]: "1.6",
  [DIFF_LINE_HEIGHT.SPACIOUS]: "1.85",
} as const satisfies Record<DiffLook["lineHeight"], string>;

export const LIGATURES = { ON: "'liga' 1, 'calt' 1", OFF: "'liga' 0, 'calt' 0" } as const;
