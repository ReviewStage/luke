import { VIRTUAL_ROW_KEY_ATTRIBUTE, type VirtualRowsHandle } from "@repo/ui/virtual-rows";
import { type RefObject, useEffect, useState } from "react";
import { type FIND_STEP, type FindSource, type FindTally, useFindSource } from "./find-in-tab.js";
import {
  type FindPainting,
  findRanges,
  NO_PAINTING,
  repaint,
  reveal,
  selectedWords,
  watchText,
} from "./find-matches.js";

/**
 * virtual-find.ts -- ⌘F over a tab whose rows draw only near its view (`VirtualRows`): every match counted from the rows' words, a step scrolling the run to its row, and the match painted once the row is drawn.
 *
 * A long run draws only the rows near its view, so the words of most of a
 * long transcript, a pull request's conversation, a plan's comments, or its
 * version history are in no DOM a find could read. The tab hands its scope
 * a find of its own instead, as a File tab does for the lines Pierre has not
 * drawn (`whole-file.tsx`): a match is placed by the row it is in and by how
 * many matches of that row come before it. A row drawn is counted in the
 * DOM, as the find over any tab counts (`find-matches.ts`), which is what
 * the reader sees, and that count is kept for the row while the query
 * stands; a row never drawn under the query is counted in the words it
 * holds (`FindRow`), which a step to it then counts again as drawn.
 * Whatever the scroller draws outside the rows is counted in the DOM, what
 * stands before the run's first row drawn as one row of its own before the
 * rows and the rest as one after them, as a pull request's description
 * stands above its conversation and its comment box below. A step to a
 * match in a row not drawn scrolls the run to that row (`VirtualRowsHandle`),
 * and the match is painted and centered once the row is drawn, any fold
 * around it opened, as the DOM's find opens one.
 */

/** A row as the find reads it before it is drawn: its key, and the words it holds. */
export interface FindRow {
  readonly key: string;
  readonly words: string;
}

/** Where a match stands outside the rows: before the run's first row drawn, or after them. */
const OUTSIDE = {
  BEFORE: "before",
  AFTER: "after",
} as const;

type Outside = (typeof OUTSIDE)[keyof typeof OUTSIDE];

/** One match: the row it is in, or where it stands outside them, and how many matches there come before it. */
interface RowMatch {
  readonly row: string | Outside;
  readonly outside: boolean;
  readonly nth: number;
}

/** The drawn ranges grouped by where they stand, each group in the order drawn. */
interface Grouped {
  readonly before: Range[];
  readonly rows: Map<string, Range[]>;
  readonly after: Range[];
}

/** Nothing drawn under a query. */
function noRanges(): Grouped {
  return { before: [], rows: new Map(), after: [] };
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

/** The element `node` stands in, across a shadow root to its host, as the find reads a host's words (`FIND_SHADOW_ATTRIBUTE`). */
function parentAcross(node: Node): Element | null {
  if (node.parentElement !== null) return node.parentElement;
  const root = node.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** The row a drawn range stands in, across any shadow root between; none outside every row. */
function rowOf(range: Range): Element | undefined {
  const start = range.startContainer;
  for (
    let at: Element | null = start instanceof Element ? start : parentAcross(start);
    at !== null;
    at = parentAcross(at)
  ) {
    if (at.hasAttribute(VIRTUAL_ROW_KEY_ATTRIBUTE)) return at;
  }
  return undefined;
}

/** The element of the document `range` stands in, out of any shadow root, which its place among the rows is read by. */
function lightOf(range: Range): Node {
  let at: Node = range.startContainer;
  for (let root = at.getRootNode(); root instanceof ShadowRoot; root = at.getRootNode()) {
    at = root.host;
  }
  return at;
}

/** The drawn ranges grouped by the row each stands in, or by whether it stands before `first`, the run's first row drawn, or after the rows. */
function byRow(ranges: readonly Range[], first: HTMLElement | undefined): Grouped {
  const grouped = noRanges();
  for (const range of ranges) {
    const row = rowOf(range)?.getAttribute(VIRTUAL_ROW_KEY_ATTRIBUTE);
    if (row !== undefined && row !== null) {
      grouped.rows.set(row, [...(grouped.rows.get(row) ?? []), range]);
    } else if (
      first !== undefined &&
      (first.compareDocumentPosition(lightOf(range)) & Node.DOCUMENT_POSITION_PRECEDING) !== 0
    ) {
      grouped.before.push(range);
    } else {
      grouped.after.push(range);
    }
  }
  return grouped;
}

/** The ranges drawn for one match's place. */
function rangesOf(grouped: Grouped, match: RowMatch): readonly Range[] | undefined {
  if (!match.outside) return grouped.rows.get(match.row);
  return match.row === OUTSIDE.BEFORE ? grouped.before : grouped.after;
}

/** Whether two matches name the same one. */
function sameMatch(a: RowMatch | undefined, b: RowMatch): boolean {
  return a !== undefined && a.row === b.row && a.outside === b.outside && a.nth === b.nth;
}

/** The matches a place holds, each counted from its first. */
function matchesAt(row: string | Outside, outside: boolean, count: number): RowMatch[] {
  return Array.from({ length: count }, (_, nth) => ({ row, outside, nth }));
}

/**
 * The find over a run of rows, as its tab's scope's source, for as long as
 * `findable`: matches read from the rows' words and the drawn rows, painted
 * where drawn under `root`, the run's scroll box.
 */
export function useVirtualFind(input: {
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
    /** Every match: what stands before the rows, each row's from what it last drew where it was drawn under the query, else from its words, then what stands after the rows. */
    const readMatches = (grouped: Grouped): RowMatch[] => {
      for (const [row, ranges] of grouped.rows) state.drawn.set(row, ranges.length);
      const matches = matchesAt(OUTSIDE.BEFORE, true, grouped.before.length);
      for (const row of latestRows.current) {
        const count = state.drawn.get(row.key) ?? countIn(row.words, state.query);
        matches.push(...matchesAt(row.key, false, count));
      }
      matches.push(...matchesAt(OUTSIDE.AFTER, true, grouped.after.length));
      return matches;
    };
    /** Paints the drawn matches, the one the find is at brought into view where it waits to be. */
    const paint = (grouped: Grouped) => {
      const box = root.current;
      const match = state.matches[state.at];
      const ranges = [...grouped.before, ...[...grouped.rows.values()].flat(), ...grouped.after];
      const current = match === undefined ? undefined : rangesOf(grouped, match)?.[match.nth];
      const next = { ranges, at: current === undefined ? -1 : ranges.indexOf(current) };
      repaint(state.painting, next);
      state.painting = next;
      if (state.pending && current !== undefined && box !== null) {
        state.pending = false;
        reveal(current, box);
      }
    };
    const drawnRanges = (): Grouped => {
      const box = root.current;
      if (box === null || state.query.length === 0) return noRanges();
      const run = handle.current;
      const first = run?.rowElement(run.drawnKeys()[0] ?? "");
      return byRow(findRanges(box, state.query), first);
    };
    /** Takes the find to the match it is at: its row scrolled into view where it is not drawn, and painted once it is. */
    const go = () => {
      tell();
      const match = state.matches[state.at];
      state.pending = match !== undefined;
      const grouped = drawnRanges();
      if (match !== undefined && !match.outside && !grouped.rows.has(match.row)) {
        handle.current?.bringIn(match.row);
      }
      paint(grouped);
    };
    /** The match a new query starts at: the first drawn at or below the view's top, else the first in or after the rows drawn. */
    const startAt = (grouped: Grouped): number => {
      if (state.matches.length === 0) return -1;
      const top = root.current?.getBoundingClientRect().top ?? 0;
      const places: [RowMatch["row"], boolean, readonly Range[]][] = [
        [OUTSIDE.BEFORE, true, grouped.before],
        ...[...grouped.rows].map(([row, ranges]): [string, boolean, Range[]] => [
          row,
          false,
          ranges,
        ]),
        [OUTSIDE.AFTER, true, grouped.after],
      ];
      for (const [row, outside, ranges] of places) {
        const nth = ranges.findIndex((range) => range.getBoundingClientRect().bottom >= top);
        if (nth === -1) continue;
        const at = state.matches.findIndex((match) => sameMatch(match, { row, outside, nth }));
        if (at !== -1) return at;
      }
      const keys = latestRows.current.map((row) => row.key);
      const from = keys.indexOf(handle.current?.drawnKeys()[0] ?? "");
      const after = state.matches.findIndex((match) =>
        match.outside ? match.row === OUTSIDE.AFTER : keys.indexOf(match.row) >= from,
      );
      return Math.max(0, after);
    };
    /** Reads the matches again as rows are drawn, grow, or land, keeping to the match the find is at. */
    const refresh = () => {
      if (state.query.length === 0) return;
      const was = state.matches[state.at];
      const grouped = drawnRanges();
      state.matches = readMatches(grouped);
      const kept =
        was === undefined ? -1 : state.matches.findIndex((match) => sameMatch(was, match));
      // Note that a row counted from its words and found to draw fewer keeps the find on its last.
      const fallback = state.matches.findLastIndex(
        (match) => match.row === was?.row && match.outside === was.outside,
      );
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
  // Note that the tints are taken away with the run, since they name ranges of its rows.
  useEffect(() => find.source.clear, [find]);
  // New rows may hold matches no row has drawn.
  useEffect(() => find.refresh(), [find, input.rows]);
}
