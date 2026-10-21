import { VIRTUAL_ROW_KEY_ATTRIBUTE, type VirtualRowsHandle } from "@luke/ui/virtual-rows";
import { type RefObject, useEffect, useState } from "react";
import { type FIND_STEP, type FindSource, type FindTally, useFindSource } from "../find-in-tab.js";
import {
  type FindPainting,
  findRanges,
  NO_PAINTING,
  repaint,
  reveal,
  selectedWords,
  watchText,
} from "../find-matches.js";

/**
 * transcript-find.ts -- ⌘F over an agent's transcript, whose log draws only the rows near its view: every match counted from the messages' words, a step scrolling the log to its row, and the match painted once the row is drawn.
 *
 * A long log draws only the rows near its view (`ConversationRows`), so the
 * words of most of a long transcript are in no DOM a find could read. The
 * transcript hands its tab's scope a find of its own instead, as a File tab
 * does for the lines Pierre has not drawn (`whole-file.tsx`): a match is
 * placed by the row it is in and by how many matches of that row come
 * before it. A row drawn is counted in the DOM, as the find over any tab
 * counts (`../find-matches.ts`), which is what the reader sees, and that
 * count is kept for the row while the query stands; a row never drawn under
 * the query is counted in the words its messages hold (`FindRow`), which a
 * step to it then counts again as drawn. Whatever stands after the rows, a
 * working line's or an end line's, is counted in the DOM as one row of its
 * own at the end. A step to a match in a row not drawn scrolls the log to
 * that row (`VirtualRowsHandle`), and the match is painted and centred once
 * the row is drawn, any fold around it opened, as the DOM's find opens one.
 */

/** A row as the find reads it before it is drawn: its key, and the words its messages hold. */
export interface FindRow {
  readonly key: string;
  readonly words: string;
}

/** One match: the row it is in, none for what stands after the rows, and how many matches of that row come before it. */
interface RowMatch {
  readonly row: string | undefined;
  readonly nth: number;
}

/** How a find steps. */
type FindStep = (typeof FIND_STEP)[keyof typeof FIND_STEP];

/** No matches. */
const NO_TALLY: FindTally = { count: 0, at: -1 };

/** The characters a query's text is escaped of, to be matched as typed. */
const PATTERN_SYNTAX = /[.*+?^${}()|[\]\\/]/g;

/** How many times `query` stands in `words`, as typed and without regard to case. */
function countIn(words: string, query: string): number {
  const pattern = new RegExp(query.replace(PATTERN_SYNTAX, "\\$&"), "giu");
  let count = 0;
  for (const _match of words.matchAll(pattern)) count += 1;
  return count;
}

/** The key of the row a drawn range stands in; none for what stands after the rows. */
function rowOf(range: Range): string | undefined {
  const start = range.startContainer;
  const element = start instanceof Element ? start : start.parentElement;
  return (
    element?.closest(`[${VIRTUAL_ROW_KEY_ATTRIBUTE}]`)?.getAttribute(VIRTUAL_ROW_KEY_ATTRIBUTE) ??
    undefined
  );
}

/** The drawn ranges grouped by their row, in the order drawn. */
function byRow(ranges: readonly Range[]): Map<string | undefined, Range[]> {
  const grouped = new Map<string | undefined, Range[]>();
  for (const range of ranges) {
    const row = rowOf(range);
    grouped.set(row, [...(grouped.get(row) ?? []), range]);
  }
  return grouped;
}

/**
 * The find over the transcript, as its tab's scope's source, for as long as
 * `findable`: matches read from the rows' words and the drawn rows, painted
 * where drawn under `root`, the log's scroll box.
 */
export function useTranscriptFind(input: {
  root: RefObject<HTMLElement | null>;
  rows: readonly FindRow[];
  handle: RefObject<VirtualRowsHandle | null>;
  findable: boolean;
}): void {
  const { root, handle } = input;
  const [latestRows] = useState(() => ({ current: input.rows }));
  latestRows.current = input.rows;
  const [find] = useState(() => {
    const state = {
      query: "",
      matches: [] as RowMatch[],
      at: -1,
      painting: NO_PAINTING as FindPainting,
      // Whether the match the find is at still waits to be brought into view, once drawn.
      pending: false,
      // Each row's count as it was last drawn under the query.
      drawn: new Map<string, number>(),
      listeners: new Set<(tally: FindTally) => void>(),
      unwatch: undefined as (() => void) | undefined,
    };
    const tell = () => {
      const tally = { count: state.matches.length, at: state.at };
      for (const listener of state.listeners) listener(tally);
    };
    /** Every match, each row's from what it last drew where it was drawn under the query, else from its words, then what stands after the rows. */
    const readMatches = (grouped: Map<string | undefined, Range[]>): RowMatch[] => {
      for (const [row, ranges] of grouped)
        if (row !== undefined) state.drawn.set(row, ranges.length);
      const matches: RowMatch[] = [];
      for (const row of latestRows.current) {
        const count = state.drawn.get(row.key) ?? countIn(row.words, state.query);
        for (let nth = 0; nth < count; nth += 1) matches.push({ row: row.key, nth });
      }
      const after = grouped.get(undefined)?.length ?? 0;
      for (let nth = 0; nth < after; nth += 1) matches.push({ row: undefined, nth });
      return matches;
    };
    /** Paints the drawn matches, the one the find is at brought into view where it waits to be. */
    const paint = (grouped: Map<string | undefined, Range[]>) => {
      const box = root.current;
      const match = state.matches[state.at];
      const ranges = [...grouped.values()].flat();
      const current = match === undefined ? undefined : grouped.get(match.row)?.[match.nth];
      const next = { ranges, at: current === undefined ? -1 : ranges.indexOf(current) };
      repaint(state.painting, next);
      state.painting = next;
      if (state.pending && current !== undefined && box !== null) {
        state.pending = false;
        reveal(current, box);
      }
    };
    const drawnRanges = () => {
      const box = root.current;
      return box === null || state.query.length === 0
        ? new Map()
        : byRow(findRanges(box, state.query));
    };
    /** Takes the find to the match it is at: its row scrolled into view where it is not drawn, and painted once it is. */
    const go = () => {
      tell();
      const match = state.matches[state.at];
      state.pending = match !== undefined;
      const grouped = drawnRanges();
      if (match?.row !== undefined && !grouped.has(match.row)) handle.current?.bringIn(match.row);
      paint(grouped);
    };
    /** The match a new query starts at: the first drawn at or below the view's top, else the first in or after the rows drawn. */
    const startAt = (grouped: Map<string | undefined, Range[]>): number => {
      if (state.matches.length === 0) return -1;
      const top = root.current?.getBoundingClientRect().top ?? 0;
      for (const [row, ranges] of grouped) {
        const nth = ranges.findIndex((range) => range.getBoundingClientRect().bottom >= top);
        if (nth === -1) continue;
        const at = state.matches.findIndex((match) => match.row === row && match.nth === nth);
        if (at !== -1) return at;
      }
      const keys = latestRows.current.map((row) => row.key);
      const from = keys.indexOf(handle.current?.drawnKeys()[0] ?? "");
      const after = state.matches.findIndex(
        (match) => match.row === undefined || keys.indexOf(match.row) >= from,
      );
      return Math.max(0, after);
    };
    /** Reads the matches again as rows are drawn, grow, or land, keeping to the match the find is at. */
    const refresh = () => {
      if (state.query.length === 0) return;
      const was = state.matches[state.at];
      const grouped = drawnRanges();
      state.matches = readMatches(grouped);
      const kept = state.matches.findIndex(
        (match) => match.row === was?.row && match.nth === was?.nth,
      );
      // Note that a row counted from its words and found to draw fewer keeps the find on its last.
      const fallback = state.matches.findLastIndex((match) => match.row === was?.row);
      state.at =
        kept !== -1
          ? kept
          : fallback !== -1
            ? fallback
            : Math.min(state.at, state.matches.length - 1);
      tell();
      paint(grouped);
    };
    const search = (query: string) => {
      state.query = query;
      state.drawn.clear();
      state.unwatch?.();
      const box = root.current;
      state.unwatch = box === null ? undefined : watchText(box, refresh);
      const grouped = drawnRanges();
      state.matches = readMatches(grouped);
      state.at = startAt(grouped);
      go();
    };
    const source: FindSource = {
      search,
      step: (query: string, step: FindStep) => {
        if (query !== state.query) return search(query);
        const count = state.matches.length;
        if (count === 0) return tell();
        state.at = (state.at + step + count) % count;
        go();
      },
      clear: () => {
        repaint(state.painting, NO_PAINTING);
        state.painting = NO_PAINTING;
        state.query = "";
        state.matches = [];
        state.at = -1;
        state.pending = false;
        state.drawn.clear();
        state.unwatch?.();
        state.unwatch = undefined;
        for (const listener of state.listeners) listener(NO_TALLY);
      },
      onTally: (listener) => {
        state.listeners.add(listener);
        return () => state.listeners.delete(listener);
      },
      selection: () => (root.current === null ? undefined : selectedWords(root.current)),
    };
    return { source, refresh };
  });
  useFindSource(input.findable ? find.source : undefined);
  // Note that the tints are taken away with the transcript, since they name ranges of its rows.
  useEffect(() => find.source.clear, [find]);
  // New messages may hold matches no row has drawn.
  useEffect(() => find.refresh(), [find, input.rows]);
}
