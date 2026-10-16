import { diffChars, diffLines, diffWordsWithSpace } from "diff";

/**
 * plan-comment-anchor.ts -- where a comment's anchored words stand in a plan's text, carried through each change of the text.
 *
 * A comment thread is anchored to a stretch of the plan's Markdown, kept by
 * the service as offsets beside the thread rather than written into the
 * text, so the text every reader, model, and copy sees holds no comment's
 * markup. Every save of the text moves each anchor with its words: the words
 * the change kept still stand under it, wherever the change moved them, and
 * words written in between them join it. An anchor whose every word the
 * change took out stands nowhere, which is its words deleted; nothing here
 * finds them again.
 *
 * The change is read line by line first, then word by word inside the lines
 * it changed, then letter by letter inside the words it replaced, so a long
 * plan with a small change costs a small diff and a typo fixed inside an
 * anchored word keeps the word anchored. A word kept by coincidence between
 * two rewritten phrases holds nothing on, so a sentence rewritten whole takes
 * its anchor with it. A changed stretch too long to read finely is taken as
 * replaced whole.
 */

/** A stretch of a plan's text, from one offset up to another. */
export interface CommentSpan {
  readonly from: number;
  readonly to: number;
}

/** A run of the text the change kept: where it stood before, and where it stands after. */
interface KeptRun {
  readonly before: number;
  readonly after: number;
  readonly length: number;
}

/** The longest stretch, before and after together, read word by word; a longer one is taken as replaced whole. */
const MAX_FINE_DIFF_CHARS = 40_000;

/** The most edits a word-by-word or letter-by-letter read of one changed stretch follows before it takes the stretch as replaced whole. */
const MAX_FINE_EDITS = 4_000;

/** One part of a fine read of a changed stretch: words kept, taken out, or written in. */
interface FinePart {
  readonly value: string;
  readonly added: boolean;
  readonly removed: boolean;
}

/**
 * The parts with each kept run that is no longer than the change on either
 * side of it taken as changed too, as a semantic diff cleans up: a 'the' kept
 * between two rewritten phrases is a coincidence of the rewrite, not words
 * the writer left standing, so it holds no anchor on.
 */
function meaningful(parts: readonly FinePart[]): FinePart[] {
  const changedAround = (index: number, step: 1 | -1) => {
    let removed = 0;
    let added = 0;
    for (let at = index + step; at >= 0 && at < parts.length; at += step) {
      const part = parts[at];
      if (part === undefined || (!part.added && !part.removed)) break;
      if (part.added) added += part.value.length;
      else removed += part.value.length;
    }
    return Math.max(removed, added);
  };
  return parts.flatMap((part, index) => {
    if (part.added || part.removed) return [part];
    const length = part.value.length;
    if (length > changedAround(index, -1) || length > changedAround(index, 1)) return [part];
    return [
      { value: part.value, added: false, removed: true },
      { value: part.value, added: true, removed: false },
    ];
  });
}

/** How a changed stretch is read finely: by words, then the words it replaced by letters. */
const FINE_READS = [
  (removed: string, added: string) =>
    diffWordsWithSpace(removed, added, { maxEditLength: MAX_FINE_EDITS }),
  (removed: string, added: string) => diffChars(removed, added, { maxEditLength: MAX_FINE_EDITS }),
] as const;

/** The runs a fine read of one changed stretch kept, from where the stretch starts on each side. */
function keptFinely(
  removed: string,
  added: string,
  before: number,
  after: number,
  depth = 0,
): KeptRun[] {
  const read = FINE_READS[depth];
  if (read === undefined || removed === "" || added === "") return [];
  // Note that only one word replaced by one word is read by letters, a typo fixed, because letters common to two different phrases are coincidence.
  if (depth > 0 && /\s/u.test(removed + added)) return [];
  if (removed.length + added.length > MAX_FINE_DIFF_CHARS) return [];
  const parts = read(removed, added);
  if (parts === undefined) return [];
  const kept: KeptRun[] = [];
  let at = before;
  let to = after;
  let gone = "";
  let written = "";
  const settle = () => {
    kept.push(...keptFinely(gone, written, at, to, depth + 1));
    at += gone.length;
    to += written.length;
    gone = "";
    written = "";
  };
  for (const part of meaningful(parts)) {
    if (part.removed) gone += part.value;
    else if (part.added) written += part.value;
    else {
      settle();
      kept.push({ before: at, after: to, length: part.value.length });
      at += part.value.length;
      to += part.value.length;
    }
  }
  settle();
  return kept;
}

/** A stretch a change took out or wrote in whole, where it stood. */
interface Changed {
  readonly text: string;
  readonly at: number;
}

/**
 * The runs of `before` that still stand in `after`. Note that a block the
 * change took out in one place and wrote in, word for word, in another is
 * kept where it went, because a line diff aligns the blocks a move passes
 * over and sees the moved one as two changes, which would take its anchors
 * with it. A block counts as moved only where its words were taken out once
 * and written in once, so two copies are never told apart by guess.
 */
function keptRuns(before: string, after: string): readonly KeptRun[] {
  const kept: KeptRun[] = [];
  const removedWhole: Changed[] = [];
  const addedWhole: Changed[] = [];
  let at = 0;
  let to = 0;
  let removed = "";
  let added = "";
  const settle = () => {
    const finely = keptFinely(removed, added, at, to);
    kept.push(...finely);
    if (finely.length === 0 && removed.trim() !== "") removedWhole.push({ text: removed, at });
    if (finely.length === 0 && added.trim() !== "") addedWhole.push({ text: added, at: to });
    at += removed.length;
    to += added.length;
    removed = "";
    added = "";
  };
  for (const part of diffLines(before, after)) {
    if (part.removed) removed += part.value;
    else if (part.added) added += part.value;
    else {
      settle();
      kept.push({ before: at, after: to, length: part.value.length });
      at += part.value.length;
      to += part.value.length;
    }
  }
  settle();
  // Note that the blank lines a move carries with a block differ by where it lands, so blocks are matched without their trailing space.
  const words = (changed: Changed) => changed.text.trimEnd();
  for (const gone of removedWhole) {
    const same = addedWhole.filter((written) => words(written) === words(gone));
    const twice = removedWhole.filter((other) => words(other) === words(gone)).length > 1;
    const [moved] = same;
    if (moved !== undefined && same.length === 1 && !twice) {
      kept.push({ before: gone.at, after: moved.at, length: words(gone).length });
    }
  }
  return kept;
}

/**
 * A change of a plan's text, read once, that moves any number of anchors: an
 * anchor answers where its kept words stand now, from the first of them to
 * the last, or nothing where the change took out every one.
 */
export function textChange(
  before: string,
  after: string,
): (span: CommentSpan) => CommentSpan | undefined {
  if (before === after) return (span) => span;
  const kept = keptRuns(before, after);
  return (span) => {
    let from: number | undefined;
    let to: number | undefined;
    for (const run of kept) {
      const start = Math.max(span.from, run.before);
      const end = Math.min(span.to, run.before + run.length);
      if (start >= end) continue;
      from = Math.min(from ?? Number.POSITIVE_INFINITY, run.after + (start - run.before));
      to = Math.max(to ?? 0, run.after + (end - run.before));
    }
    return from === undefined || to === undefined ? undefined : { from, to };
  };
}

/** Whether a span stands inside a text of this length and holds at least one letter. */
export function spanWithin(span: CommentSpan, length: number): boolean {
  return (
    Number.isInteger(span.from) &&
    Number.isInteger(span.to) &&
    span.from >= 0 &&
    span.from < span.to &&
    span.to <= length
  );
}
