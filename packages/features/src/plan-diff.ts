import { diffArrays } from "diff";

/**
 * plan-diff.ts -- where one unit of the plan differs from its newer words, word by word.
 *
 * The version history's version view compares a unit's words whole word by
 * whole word (`wordChanges`), since a reader compares words rather than
 * letters. The comparison itself is jsdiff's (`diffArrays`, over this file's
 * words). Everything here is pure.
 */

/** The most words and spaces a version's unit may change before it is shown as struck whole and written whole again. */
const MAX_READ_TOKENS = 4_000;

/**
 * A picture, a word, a space, a line break, or a single mark: the units words
 * are compared in. Note that spaces are one apiece, so the gap a word was
 * struck from still matches the single space around the word written into it,
 * and that a picture, `![alt](address "title")` with an address holding a
 * pair of parentheses as CommonMark allows, is one unit, so a picture
 * replaced is one struck and one written in rather than the letters of two
 * addresses run together. Its alt text and its address are bounded, because
 * static analysis reads an unbounded run after `![` as rescanned from every
 * `![` of a line that never closes one; a longer picture is read as its
 * words and marks, as every picture was before.
 */
const TOKEN =
  /!\[(?:\\.|[^\]\\\n]){0,1000}\]\((?:\\.|\([^()\s]{0,2000}\)|[^()\\\n]){0,2000}\)|\n|[^\S\n]|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

function tokens(words: string): readonly string[] {
  return words.match(TOKEN) ?? [];
}

/** One run of words two texts compare as: the words, and whether the newer text added them, struck them, or keeps them. */
export interface WordChange {
  readonly words: string;
  readonly added: boolean;
  readonly removed: boolean;
}

/**
 * The old words and the newer compared whole word by whole word, in reading
 * order, every run of the old struck and of the newer added, where the struck
 * words of a change come before the words that replace them. A unit changed
 * past `MAX_READ_TOKENS` is one run struck and one added.
 */
export function wordChanges(old: string, next: string): readonly WordChange[] {
  if (old === next) return old === "" ? [] : [{ words: old, added: false, removed: false }];
  const changes = diffArrays([...tokens(old)], [...tokens(next)], {
    maxEditLength: MAX_READ_TOKENS,
  });
  if (changes === undefined) {
    return [
      { words: old, added: false, removed: true },
      { words: next, added: true, removed: false },
    ].filter((change) => change.words !== "");
  }
  return changes.map((change) => ({
    words: change.value.join(""),
    added: change.added,
    removed: change.removed,
  }));
}
