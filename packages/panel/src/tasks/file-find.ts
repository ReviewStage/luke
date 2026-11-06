const PATTERN_SYNTAX = /[.*+?^${}()|[\]\\/]/g;

export interface FindNote {
  readonly key: string;
  readonly line: number;
  readonly matches: number;
}

export interface FileMatch {
  readonly line: number;
  readonly note: string | undefined;
  readonly nth: number;
}

function countIn(words: string, pattern: RegExp): number {
  let count = 0;
  for (const _match of words.matchAll(pattern)) count += 1;
  return count;
}

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

export function matchFrom(matches: readonly FileMatch[], line: number): number {
  if (matches.length === 0) return -1;
  return Math.max(
    0,
    matches.findIndex((match) => match.line >= line),
  );
}
