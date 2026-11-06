export function searchTokens(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

export function matchesTokens(lines: readonly string[], tokens: readonly string[]): boolean {
  const read = lines.map((line) => line.toLowerCase());
  return tokens.every((token) => read.some((line) => line.includes(token)));
}

export interface MatchRange {
  start: number;
  end: number;
}

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
