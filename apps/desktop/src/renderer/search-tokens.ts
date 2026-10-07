/**
 * search-tokens.ts -- the word search the settings search reads a query with.
 */

/**
 * A query read into the words it asks for: lowercased and split on whitespace,
 * because matching is case-blind and every word must be found somewhere. A
 * blank query has no words, which is what makes it no search at all.
 */
export function searchTokens(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * Every one of a query's words somewhere in the lines read: words narrow, they
 * never widen.
 */
export function matchesTokens(lines: readonly string[], tokens: readonly string[]): boolean {
  const read = lines.map((line) => line.toLowerCase());
  return tokens.every((token) => read.some((line) => line.includes(token)));
}

/** One stretch of a drawn line that a query's word landed on. */
interface MatchRange {
  start: number;
  end: number;
}

/**
 * Where a query's words sit in one drawn line, so the line can show why it
 * matched. Every occurrence of every word is taken and overlapping stretches
 * are merged, because two words landing on one stretch of text should read as
 * one mark rather than nested ones.
 */
export function matchRanges(text: string, tokens: readonly string[]): readonly MatchRange[] {
  const lowered = text.toLowerCase();
  const found: MatchRange[] = [];
  for (const token of tokens) {
    for (let from = lowered.indexOf(token); from !== -1; from = lowered.indexOf(token, from + 1)) {
      found.push({ start: from, end: from + token.length });
    }
  }
  found.sort((first, second) => first.start - second.start || first.end - second.end);
  const merged: MatchRange[] = [];
  for (const range of found) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}
