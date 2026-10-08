import { PLAN_EMPTY_TEXT } from "@sidecar/hosted/plan-template";
import { diffArrays } from "diff";

/**
 * plan-diff.ts -- where one unit of the plan differs from its newer words: the edits a person would make, word by word.
 *
 * The plan's typing plays these edits one at a time, so they are cut the way
 * someone taking notes would make them rather than the shortest way: whole
 * words, a lone shared word between two changes folded into one change, and
 * a line added or struck aligned to whole lines. The comparison itself is
 * jsdiff's (`diffArrays`, over this file's words); what is here is how its
 * changes are cut for a hand. The notetaker changes one place at a time
 * (`notesInProgress` in `@sidecar/hosted/plan-template`), so the words
 * compared are always final or still growing at their end. Everything here
 * is pure.
 */

/** The most words and spaces a diff may change before the whole unit is taken as one replacement. */
const MAX_EDIT_TOKENS = 400;

/**
 * A word, a space, a line break, or a single mark: the units an edit is made
 * of. Note that spaces are one apiece, so the gap a word was erased from
 * still matches the single space around the word typed into it.
 */
const TOKEN = /\n|[^\S\n]|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

/** One change to the old words: the span from `from` to `to` replaced by `insert`, offsets in the old words. */
export interface Hunk {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

const PLACEHOLDERS: ReadonlySet<string> = new Set(Object.values(PLAN_EMPTY_TEXT));

function tokens(words: string): readonly string[] {
  return words.match(TOKEN) ?? [];
}

/** Whether the span from `from` to `to` of the words is one or more whole lines, with a break on one side. */
function wholeLines(words: string, from: number, to: number): boolean {
  const span = words.slice(from, to);
  const opens = from === 0 || words[from - 1] === "\n" || span.startsWith("\n");
  const closes = to === words.length || words[to] === "\n" || span.endsWith("\n");
  return opens && closes;
}

/**
 * A change that only erases or only inserts, slid along the identical words
 * around it, within `lower` and `upper`, to where it covers whole lines, if
 * there is such a place: the same change, as a hand making it would see it.
 * Note that the words compared see "invite.\n- " as easily as "- ...invite.\n",
 * so a line added or struck is found wherever the comparison happened to cut it.
 */
function lineAligned(old: string, hunk: Hunk, lower: number, upper: number): Hunk {
  const erasing = hunk.insert === "";
  if (erasing === (hunk.from === hunk.to)) return hunk;
  let { from, to } = hunk;
  let words = erasing ? old.slice(from, to) : hunk.insert;
  // Slide to the leftmost place first, then try each place rightward.
  while (from > lower && old[from - 1] === words.at(-1)) {
    words = `${words.at(-1)}${words.slice(0, -1)}`;
    from -= 1;
    to -= 1;
  }
  for (;;) {
    const whole = erasing ? wholeLines(old, from, to) : wholeInsert(old, from, words);
    if (whole) return erasing ? { from, to, insert: "" } : { from, to: from, insert: words };
    if (to >= upper || old[to] !== words[0]) return hunk;
    words = `${words.slice(1)}${words[0]}`;
    from += 1;
    to += 1;
  }
}

/** Whether words inserted at `at` land as whole lines, with a break on one side. */
function wholeInsert(old: string, at: number, words: string): boolean {
  const opens = at === 0 || old[at - 1] === "\n" || words.startsWith("\n");
  const closes = at === old.length || old[at] === "\n" || words.endsWith("\n");
  return opens && closes;
}

/**
 * One change with the letters both sides share at its ends left standing
 * when it changes one word into another, so a word typed partway carries on
 * rather than being erased and typed again, and "member" becoming "members"
 * types the one letter. A change spanning words is left whole, since a hand
 * selects "an admin" to type "a member" rather than keeping the "a".
 */
function narrowed(old: string, hunk: Hunk): Hunk {
  const { from, insert: typed } = hunk;
  const erased = old.slice(from, hunk.to);
  if (/\s/u.test(erased) || /\s/u.test(typed)) return hunk;
  let head = 0;
  while (head < erased.length && head < typed.length && erased[head] === typed[head]) head += 1;
  let tail = 0;
  while (
    tail < erased.length - head &&
    tail < typed.length - head &&
    erased[erased.length - 1 - tail] === typed[typed.length - 1 - tail]
  ) {
    tail += 1;
  }
  return {
    from: from + head,
    to: from + erased.length - tail,
    insert: typed.slice(head, typed.length - tail),
  };
}

/**
 * Folds two changes separated by a single shared word or space into one, so
 * "the" left standing between two rewritten words does not split the edit
 * into two trips. A shared line break always separates.
 */
function folded(old: string, hunks: readonly Hunk[]): readonly Hunk[] {
  const merged: Hunk[] = [];
  for (const hunk of hunks) {
    const previous = merged.at(-1);
    const between = previous === undefined ? "" : old.slice(previous.to, hunk.from);
    if (previous !== undefined && !between.includes("\n") && tokens(between).length === 1) {
      merged[merged.length - 1] = {
        from: previous.from,
        to: hunk.to,
        insert: previous.insert + between + hunk.insert,
      };
    } else merged.push(hunk);
  }
  return merged;
}

/**
 * The edits that turn the old words into the newer ones, in document order,
 * offsets in the old words. Words are compared whole, and only the letters
 * that differ at a changed word's ends are touched; a change past
 * `MAX_EDIT_TOKENS` is one replacement of the whole unit.
 */
export function diffHunks(old: string, next: string): readonly Hunk[] {
  if (old === next) return [];
  const changes = diffArrays([...tokens(old)], [...tokens(next)], {
    maxEditLength: MAX_EDIT_TOKENS,
  });
  if (changes === undefined) return [{ from: 0, to: old.length, insert: next }];
  const hunks: Hunk[] = [];
  let at = 0;
  let open: { from: number; erased: string; typed: string } | undefined;
  for (const change of changes) {
    const words = change.value.join("");
    if (!change.added && !change.removed) {
      if (open !== undefined) {
        hunks.push({ from: open.from, to: open.from + open.erased.length, insert: open.typed });
      }
      open = undefined;
      at += words.length;
      continue;
    }
    open ??= { from: at, erased: "", typed: "" };
    if (change.removed) {
      open.erased += words;
      at += words.length;
    } else open.typed += words;
  }
  if (open !== undefined) {
    hunks.push({ from: open.from, to: open.from + open.erased.length, insert: open.typed });
  }
  const cutHunks = folded(old, hunks).map((hunk) => narrowed(old, hunk));
  return cutHunks.map((hunk, index) =>
    lineAligned(old, hunk, cutHunks[index - 1]?.to ?? 0, cutHunks[index + 1]?.from ?? old.length),
  );
}

/** Whether a span of old words is a field's empty placeholder, which is cleared at once rather than kept or erased letter by letter. */
export function isPlaceholder(words: string): boolean {
  return PLACEHOLDERS.has(words.trim());
}
