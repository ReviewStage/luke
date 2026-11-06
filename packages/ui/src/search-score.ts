import { namesTaskKey } from "@repo/features/workspace-key";
import { type MatchRange, searchTokens } from "./search-tokens.js";

export const SEARCH_TIER = {
  KEY: "key",
  PREFIX: "prefix",
  WORD_STARTS: "word-starts",
  WORDS: "words",
  KEYWORDS: "keywords",
  LOOSE: "loose",
} as const;

export type SearchTier = (typeof SEARCH_TIER)[keyof typeof SEARCH_TIER];

export const LOOSE_FROM = 3;

const TIER_RANK = {
  [SEARCH_TIER.KEY]: 6,
  [SEARCH_TIER.PREFIX]: 5,
  [SEARCH_TIER.WORD_STARTS]: 4,
  [SEARCH_TIER.WORDS]: 3,
  [SEARCH_TIER.KEYWORDS]: 2,
  [SEARCH_TIER.LOOSE]: 1,
} as const satisfies Record<SearchTier, number>;

const CLOSENESS_CEILING = 0.99;

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

const CAPITAL = /\p{Lu}/u;

export interface SearchSubject {
  readonly label: string;
  readonly lines?: readonly string[] | undefined;
  readonly key?: string | undefined;
  readonly keywords?: readonly string[] | undefined;
  readonly loose?: boolean | undefined;
}

export interface SearchHit {
  readonly tier: SearchTier;
  readonly score: number;
  readonly label: readonly MatchRange[];
  readonly lines: readonly (readonly MatchRange[])[];
}

function merged(ranges: readonly MatchRange[]): readonly MatchRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: MatchRange[] = [];
  for (const range of sorted) {
    const last = out.at(-1);
    if (last !== undefined && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else out.push({ ...range });
  }
  return out;
}

function startsWord(text: string, at: number): boolean {
  if (at === 0) return true;
  const before = text.charAt(at - 1);
  if (!WORD_CHARACTER.test(before)) return true;
  const here = text.charAt(at);
  return CAPITAL.test(here) && before === before.toLowerCase() && before !== before.toUpperCase();
}

function placeOf(text: string, token: string, wordStart: boolean): number {
  const lowered = text.toLowerCase();
  for (let at = lowered.indexOf(token); at !== -1; at = lowered.indexOf(token, at + 1)) {
    if (!wordStart || startsWord(text, at)) return at;
  }
  return -1;
}

function placed(
  texts: readonly string[],
  tokens: readonly string[],
  wordStart: boolean,
): MatchRange[][] | undefined {
  const ranges: MatchRange[][] = texts.map(() => []);
  for (const token of tokens) {
    const index = texts.findIndex((text) => placeOf(text, token, wordStart) !== -1);
    if (index === -1) return undefined;
    const at = placeOf(texts[index] ?? "", token, wordStart);
    ranges[index]?.push({ start: at, end: at + token.length });
  }
  return ranges;
}

function looseRun(
  text: string,
  letters: string,
): { positions: number[]; span: number } | undefined {
  const lowered = text.toLowerCase();
  let best: { positions: number[]; span: number } | undefined;
  for (let start = lowered.indexOf(letters.charAt(0)); start !== -1; ) {
    const positions = [start];
    let at = start;
    for (const letter of letters.slice(1)) {
      at = lowered.indexOf(letter, at + 1);
      if (at === -1) break;
      positions.push(at);
    }
    if (at === -1) break;
    const span = at - start + 1;
    if (best === undefined || span < best.span) best = { positions, span };
    start = lowered.indexOf(letters.charAt(0), start + 1);
  }
  return best;
}

function hitOf(tier: SearchTier, closeness: number, ranges: readonly MatchRange[][]): SearchHit {
  const [label = [], ...lines] = ranges;
  return {
    tier,
    score: TIER_RANK[tier] + Math.min(closeness, 1) * CLOSENESS_CEILING,
    label: merged(label),
    lines: lines.map(merged),
  };
}

function labelShare(ranges: readonly MatchRange[][], tokens: readonly string[]): number {
  return (ranges[0]?.length ?? 0) / tokens.length;
}

function looseHit(texts: readonly string[], letters: string): SearchHit | undefined {
  for (const [index, text] of texts.entries()) {
    const run = looseRun(text, letters);
    if (run === undefined) continue;
    const ranges: MatchRange[][] = texts.map(() => []);
    ranges[index] = run.positions.map((at) => ({ start: at, end: at + 1 }));
    return hitOf(SEARCH_TIER.LOOSE, letters.length / run.span, ranges);
  }
  return undefined;
}

export function searchHit(subject: SearchSubject, query: string): SearchHit | undefined {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return undefined;
  const { label, key, keywords } = subject;
  const lines = subject.lines ?? [];
  const texts = [label, ...lines];
  const none = (): MatchRange[][] => texts.map(() => []);
  if (key !== undefined && namesTaskKey(query, key.toUpperCase())) {
    const ranges = texts.map((text) => {
      const at = placeOf(text, key.toLowerCase(), false);
      return at === -1 ? [] : [{ start: at, end: at + key.length }];
    });
    return hitOf(SEARCH_TIER.KEY, 1, ranges);
  }
  const typed = tokens.join(" ");
  if (label.toLowerCase().startsWith(typed)) {
    const ranges = none();
    ranges[0] = [{ start: 0, end: typed.length }];
    return hitOf(SEARCH_TIER.PREFIX, typed.length === label.length ? 1 : 0, ranges);
  }
  const starts = placed(texts, tokens, true);
  if (starts !== undefined)
    return hitOf(SEARCH_TIER.WORD_STARTS, labelShare(starts, tokens), starts);
  const anywhere = placed(texts, tokens, false);
  if (anywhere !== undefined)
    return hitOf(SEARCH_TIER.WORDS, labelShare(anywhere, tokens), anywhere);
  if (keywords !== undefined && placed([...texts, ...keywords], tokens, false) !== undefined) {
    const ranges = texts.map((text) =>
      tokens.flatMap((token) => {
        const at = placeOf(text, token, false);
        return at === -1 ? [] : [{ start: at, end: at + token.length }];
      }),
    );
    return hitOf(SEARCH_TIER.KEYWORDS, 0, ranges);
  }
  const letters = tokens.join("");
  if (subject.loose !== true || letters.length < LOOSE_FROM) return undefined;
  return looseHit(texts, letters);
}

export function hitRangesIn(
  text: string,
  subject: SearchSubject,
  hit: SearchHit,
): readonly MatchRange[] {
  const found: MatchRange[] = [];
  for (const [index, line] of (subject.lines ?? []).entries()) {
    const ranges = hit.lines[index] ?? [];
    if (ranges.length === 0 || line === "") continue;
    const inText = text.indexOf(line);
    const inLine = line.indexOf(text);
    for (const range of ranges) {
      if (inText !== -1) {
        found.push({ start: range.start + inText, end: range.end + inText });
      } else if (inLine !== -1 && range.end > inLine && range.start < inLine + text.length) {
        found.push({
          start: Math.max(range.start, inLine) - inLine,
          end: Math.min(range.end, inLine + text.length) - inLine,
        });
      }
    }
  }
  return merged(found);
}
