import { diffChars, diffLines, diffWordsWithSpace } from "diff";

export interface CommentSpan {
  readonly from: number;
  readonly to: number;
}

interface KeptRun {
  readonly before: number;
  readonly after: number;
  readonly length: number;
}

const MAX_FINE_DIFF_CHARS = 40_000;

const MAX_FINE_EDITS = 4_000;

interface FinePart {
  readonly value: string;
  readonly added: boolean;
  readonly removed: boolean;
}

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

const FINE_READS = [
  (removed: string, added: string) =>
    diffWordsWithSpace(removed, added, { maxEditLength: MAX_FINE_EDITS }),
  (removed: string, added: string) => diffChars(removed, added, { maxEditLength: MAX_FINE_EDITS }),
] as const;

function keptFinely(
  removed: string,
  added: string,
  before: number,
  after: number,
  depth = 0,
): KeptRun[] {
  const read = FINE_READS[depth];
  if (read === undefined || removed === "" || added === "") return [];
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

interface Changed {
  readonly text: string;
  readonly at: number;
}

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

export function spanWithin(span: CommentSpan, length: number): boolean {
  return (
    Number.isInteger(span.from) &&
    Number.isInteger(span.to) &&
    span.from >= 0 &&
    span.from < span.to &&
    span.to <= length
  );
}
