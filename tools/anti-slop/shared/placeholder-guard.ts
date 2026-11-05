/**
 * placeholder-guard.ts -- what the `no-placeholder-ellipsis` rule reads: the
 * name a placeholder goes by and the ending it never takes. A placeholder that
 * asks for something ("Search workspaces", "Assign to") ends on its last word,
 * never "…", while one that shows a value's shape with its rest elided
 * (`ghp_…`) keeps the ellipsis, which follows no letter, digit or space there.
 * The rule started clean, so it takes no baseline.
 */
export const PLACEHOLDER_GUARD_RULE = "anti-slop/no-placeholder-ellipsis";

/** The JSX attribute and object property a placeholder is passed under. */
export const PLACEHOLDER_NAME = "placeholder";

/** An ellipsis, one glyph or three dots, ending words: after a letter, digit, or space. */
export const TRAILING_ELLIPSIS = /[\p{L}\p{N} ](?:…|\.\.\.)$/u;

/**
 * An ellipsis ending a quoted string, as far as the text says: the glyph,
 * three dots, or the glyph escaped (`\u2026`, `\u{2026}`) or written as a JSX
 * entity (`&hellip;`, `&#8230;`, `&#x2026;`), which the rule reads decoded.
 */
const QUOTED_TRAILING_ELLIPSIS =
  /[\p{L}\p{N} ](?:…|\.\.\.|\\u2026|\\u\{2026\}|&hellip;|&#8230;|&#x2026;)["'`]/iu;

/**
 * Whether a file's text names a placeholder and holds words ending in an
 * ellipsis: the only file the rule could refuse, so the only one with
 * anything to silence.
 */
export function namesEllipsisPlaceholder(text: string): boolean {
  return text.includes(PLACEHOLDER_NAME) && QUOTED_TRAILING_ELLIPSIS.test(text);
}
