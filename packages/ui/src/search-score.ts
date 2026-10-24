/**
 * search-score.ts -- the one tiered search scorer: how well a row answers what was typed, and the stretches of its words that say why.
 *
 * A row answers a query in the first of these tiers it meets, every row of a
 * tier ranking above every row of the next:
 *
 *   1. the task key typed whole, as `stag-42` is STAG-42;
 *   2. the label starts with the query;
 *   3. every word typed starts a word of the label or the row's other lines;
 *   4. every word typed is somewhere in the label or those lines;
 *   5. every word typed is in the row's keywords, words it is found by and
 *      never draws, such as a setting's description;
 *   6. the letters typed stand in order in the label or a line, only for a
 *      row that asks for it (a path, a command), and only from three letters.
 *
 * Note that a match never needs the last tier to be found, which is what
 * keeps "thm" from finding Theme: letters in order are loose enough to find
 * almost any long line, so they are offered only where a row's words are
 * typed the way a path or a command is, by their first letters.
 *
 * The hit says where its tier landed, in the label and in each line, so a
 * row marks exactly what found it, a loose hit's scattered letters included.
 */

import { namesTaskKey } from "@luke/features/workspace-key";
import { type MatchRange, searchTokens } from "./search-tokens.js";

/** Each way a row can answer a query, in the order they rank. */
export const SEARCH_TIER = {
  KEY: "key",
  PREFIX: "prefix",
  WORD_STARTS: "word-starts",
  WORDS: "words",
  KEYWORDS: "keywords",
  LOOSE: "loose",
} as const;

export type SearchTier = (typeof SEARCH_TIER)[keyof typeof SEARCH_TIER];

/** How many letters typed in order a loose row asks for before they find it. */
export const LOOSE_FROM = 3;

/** Each tier's place: a hit's score is its tier's place and a closeness under one beside it. */
const TIER_RANK = {
  [SEARCH_TIER.KEY]: 6,
  [SEARCH_TIER.PREFIX]: 5,
  [SEARCH_TIER.WORD_STARTS]: 4,
  [SEARCH_TIER.WORDS]: 3,
  [SEARCH_TIER.KEYWORDS]: 2,
  [SEARCH_TIER.LOOSE]: 1,
} as const satisfies Record<SearchTier, number>;

/** The most a closeness adds, kept under one so it never lifts a hit into the tier above. */
const CLOSENESS_CEILING = 0.99;

/** A letter or a figure, which a word is made of; anything else stands between words. */
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/** A capital, which starts a word where it follows a small letter, as in `fileRow`. */
const CAPITAL = /\p{Lu}/u;

/** What a row is searched by. */
export interface SearchSubject {
  /** The row's name as it is drawn, which tiers 2 to 4 read first. */
  readonly label: string;
  /** The rest of what the row says or is known by, a line each: its detail, a task's repository and people, a file's path. */
  readonly lines?: readonly string[] | undefined;
  /** A task's key, as STAG-42, which typed whole finds its task first. */
  readonly key?: string | undefined;
  /** Words the row is found by and never draws. */
  readonly keywords?: readonly string[] | undefined;
  /** Whether the letters typed in order find it, as a path's or a command's do. */
  readonly loose?: boolean | undefined;
}

/** How a row answered a query: its tier, a score to rank by, and where it matched. */
export interface SearchHit {
  readonly tier: SearchTier;
  /** Higher is better: the tier first, then how closely within it. */
  readonly score: number;
  /** Where the label was matched. */
  readonly label: readonly MatchRange[];
  /** Where each line was matched, in the subject's order. */
  readonly lines: readonly (readonly MatchRange[])[];
}

/** Ranges sorted and merged where they touch, so a stretch is marked once. */
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

/** Whether a word starts at `at` in `text`: its first character, one after a gap, or a capital after a small letter. */
function startsWord(text: string, at: number): boolean {
  if (at === 0) return true;
  const before = text.charAt(at - 1);
  if (!WORD_CHARACTER.test(before)) return true;
  const here = text.charAt(at);
  return CAPITAL.test(here) && before === before.toLowerCase() && before !== before.toUpperCase();
}

/** Where `token` first stands in `text`, at a word's start where `wordStart` asks it; -1 where it does not. */
function placeOf(text: string, token: string, wordStart: boolean): number {
  const lowered = text.toLowerCase();
  for (let at = lowered.indexOf(token); at !== -1; at = lowered.indexOf(token, at + 1)) {
    if (!wordStart || startsWord(text, at)) return at;
  }
  return -1;
}

/**
 * Where every token stands in the texts, the label's first, each token at
 * its first place in the first text holding it; none where a token stands in
 * none of them. `wordStart` asks each to start a word.
 */
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

/**
 * The tightest run of `letters` in order through `text`: each place the
 * first letter stands is tried, the rest taken as soon as they come, and the
 * shortest stretch kept; none where they are not all there in order.
 */
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

/** A hit of `tier`, its closeness under one, its ranges merged. */
function hitOf(tier: SearchTier, closeness: number, ranges: readonly MatchRange[][]): SearchHit {
  const [label = [], ...lines] = ranges;
  return {
    tier,
    score: TIER_RANK[tier] + Math.min(closeness, 1) * CLOSENESS_CEILING,
    label: merged(label),
    lines: lines.map(merged),
  };
}

/** How many of the tokens landed in the label, as a share of them all: a word tier's closeness. */
function labelShare(ranges: readonly MatchRange[][], tokens: readonly string[]): number {
  return (ranges[0]?.length ?? 0) / tokens.length;
}

/** The loose tier's hit: the letters typed in order in the label, else the tightest line. */
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

/**
 * How `subject` answers `query`, in the first tier it meets, and where; none
 * where it meets none, or where nothing is typed, which is no search at all.
 */
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
    // Note that a label typed whole ranks first, and the rest it begins keep the caller's order.
    return hitOf(SEARCH_TIER.PREFIX, typed.length === label.length ? 1 : 0, ranges);
  }
  const starts = placed(texts, tokens, true);
  if (starts !== undefined)
    return hitOf(SEARCH_TIER.WORD_STARTS, labelShare(starts, tokens), starts);
  const anywhere = placed(texts, tokens, false);
  if (anywhere !== undefined)
    return hitOf(SEARCH_TIER.WORDS, labelShare(anywhere, tokens), anywhere);
  if (keywords !== undefined && placed([...texts, ...keywords], tokens, false) !== undefined) {
    // Note that only what lands in the drawn words is marked, since the keywords are never drawn.
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

/**
 * The stretches of a hit that fall in `text`, a drawn line other than the
 * label: a line's own where `text` is that line, holds it, or is held in it,
 * each moved to where it stands in `text`. Note that a row draws its lines
 * cut or joined (a file's folder, a path's head; a detail of several), so a
 * line is found within what is drawn, or what is drawn within a line.
 */
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
