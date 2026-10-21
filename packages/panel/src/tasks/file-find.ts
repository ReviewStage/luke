/**
 * file-find.ts -- a find over a whole file a File tab draws through Pierre: every match of a query on its lines, read from its text, and in its notes, counted in the cards the tab draws, in the order the tab draws them.
 *
 * Pierre draws only the lines near the view (`../diff-view/index.ts`'s
 * `mountFile`), so the words of most of a long file are in no DOM a find
 * could read. The tab hands its scope a find of its own instead
 * (`whole-file.tsx`), which counts and steps through the matches placed here
 * and paints those Pierre has drawn. A match is placed by the line it is on,
 * or by the note it is in and the line that note stands under, and by how
 * many matches of that place come before it, which is how the tab finds its
 * painted range again among those the DOM holds. A line's matches are read
 * from the file's text as the DOM's find matches one (`../find-matches.ts`):
 * as typed, without regard to case, never across a line. A note's are
 * counted by that same find in the card the tab draws for it, which React
 * draws whether or not Pierre has its line in view, so every match counted
 * is one the reader can see.
 */

/** The characters a query's text is escaped of, to be matched as typed. */
const PATTERN_SYNTAX = /[.*+?^${}()|[\]\\/]/g;

/** A note as a find counts it: its key, the line it stands under, and how many matches its card holds. */
export interface FindNote {
  readonly key: string;
  readonly line: number;
  readonly matches: number;
}

/** One match: the line it is on or the note it is in stands under, the note's key where it is in one, and how many matches of its place come before it. */
export interface FileMatch {
  readonly line: number;
  readonly note: string | undefined;
  readonly nth: number;
}

/** How many times `pattern` stands in `words`. */
function countIn(words: string, pattern: RegExp): number {
  let count = 0;
  for (const _match of words.matchAll(pattern)) count += 1;
  return count;
}

/**
 * Every match of `query` in a file's lines, numbered from 1, and in its
 * notes, in the order the tab draws them: a line's own matches, then those
 * of the notes standing under it, in their order. None for an empty query.
 */
export function fileMatches(
  lines: readonly string[],
  notes: readonly FindNote[],
  query: string,
): FileMatch[] {
  if (query.length === 0) return [];
  const pattern = new RegExp(query.replace(PATTERN_SYNTAX, "\\$&"), "giu");
  const under = new Map<number, FindNote[]>();
  for (const note of notes) under.set(note.line, [...(under.get(note.line) ?? []), note]);
  const matches: FileMatch[] = [];
  lines.forEach((text, at) => {
    const line = at + 1;
    for (let nth = 0; nth < countIn(text, pattern); nth += 1) {
      matches.push({ line, note: undefined, nth });
    }
    for (const note of under.get(line) ?? []) {
      for (let nth = 0; nth < note.matches; nth += 1) matches.push({ line, note: note.key, nth });
    }
  });
  return matches;
}

/** The match a find starts at: the first on or after `line`, the first of all where none follows, and -1 where there is none. */
export function matchFrom(matches: readonly FileMatch[], line: number): number {
  if (matches.length === 0) return -1;
  return Math.max(
    0,
    matches.findIndex((match) => match.line >= line),
  );
}
