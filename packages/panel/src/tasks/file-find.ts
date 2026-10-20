/**
 * file-find.ts -- a find over a whole file a File tab draws through Pierre, read from its text rather than the DOM: every match of a query on its lines and in its notes' words, in the order the tab draws them.
 *
 * Pierre draws only the lines near the view (`../diff-view/index.ts`'s
 * `mountFile`), so the words of most of a long file are in no DOM a find
 * could read. The tab hands its scope a find of its own instead
 * (`whole-file.tsx`), which counts and steps through the matches read here
 * and paints those Pierre has drawn. A match is placed by the line it is on,
 * or by the note it is in and the line that note stands under, and by how
 * many matches of that place come before it, which is how the tab finds its
 * painted range again among those the DOM holds. A note is read as its card
 * shows it, not as the Markdown Luke wrote, so every match counted is one the
 * reader can see. A query matches as the
 * DOM's find matches one (`../find-matches.ts`): as typed, without regard to
 * case, never across a line.
 */

import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/** The characters a query's text is escaped of, to be matched as typed. */
const PATTERN_SYNTAX = /[.*+?^${}()|[\]\\/]/g;

/** The nodes whose children run on inside one line of a card's text; every other parent's children are blocks, each on a line of its own. */
const PHRASING_PARENTS: ReadonlySet<Nodes["type"]> = new Set([
  "paragraph",
  "heading",
  "emphasis",
  "strong",
  "delete",
  "link",
  "linkReference",
  "tableCell",
]);

/** A parsed note's words as its card draws them: text and code as written, a link by its words alone, a block's apart from the next. */
function shownWords(node: Nodes): string {
  if (node.type === "text" || node.type === "inlineCode" || node.type === "code") return node.value;
  if (node.type === "break") return "\n";
  if (!("children" in node)) return "";
  const words = node.children.map((child) => shownWords(child));
  return PHRASING_PARENTS.has(node.type) ? words.join("") : words.join("\n");
}

/**
 * A note's Markdown as its card shows it, as a find reads it: read by the
 * parser the card is drawn with, so its marks are left out, a link is read
 * by its words and never its destination, a code span's words stay as
 * written, and each block stands on a line of its own, so no match runs
 * from one into the next.
 */
export function noteFindWords(markdown: string): string {
  return shownWords(
    fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }),
  );
}

/** A note's words as a find reads them (`noteFindWords`): its key, the line it stands under, and its words, a line of the card apiece. */
export interface FindNote {
  readonly key: string;
  readonly line: number;
  readonly words: string;
}

/** One match: the line it is on or the note it is in stands under, the note's key where it is in one, and how many matches of its place come before it. */
export interface FileMatch {
  readonly line: number;
  readonly note: string | undefined;
  readonly nth: number;
}

/** How many times `query` stands in `words`, as the DOM's find matches it. */
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
      const count = note.words.split("\n").reduce((sum, words) => sum + countIn(words, pattern), 0);
      for (let nth = 0; nth < count; nth += 1) matches.push({ line, note: note.key, nth });
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
