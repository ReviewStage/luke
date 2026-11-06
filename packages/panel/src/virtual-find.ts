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

export interface FindRow {
  readonly key: string;
  readonly words: string;
}

const OUTSIDE = {
  BEFORE: "before",
  AFTER: "after",
} as const;

type Outside = (typeof OUTSIDE)[keyof typeof OUTSIDE];

interface RowMatch {
  readonly row: string | Outside;
  readonly outside: boolean;
  readonly nth: number;
}

interface Grouped {
  readonly before: Range[];
  readonly rows: Map<string, Range[]>;
  readonly after: Range[];
}

function noRanges(): Grouped {
  return { before: [], rows: new Map(), after: [] };
}

type FindStep = (typeof FIND_STEP)[keyof typeof FIND_STEP];

const NO_TALLY: FindTally = { count: 0, at: -1 };

const PATTERN_SYNTAX = /[.*+?^${}()|[\]\\/]/g;

function countIn(words: string, query: string): number {
  const pattern = new RegExp(query.replace(PATTERN_SYNTAX, "\\$&"), "giu");
  let count = 0;
  for (const _match of words.matchAll(pattern)) count += 1;
  return count;
}

function parentAcross(node: Node): Element | null {
  if (node.parentElement !== null) return node.parentElement;
  const root = node.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

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

function lightOf(range: Range): Node {
  let at: Node = range.startContainer;
  for (let root = at.getRootNode(); root instanceof ShadowRoot; root = at.getRootNode()) {
    at = root.host;
  }
  return at;
}

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

function rangesOf(grouped: Grouped, match: RowMatch): readonly Range[] | undefined {
  if (!match.outside) return grouped.rows.get(match.row);
  return match.row === OUTSIDE.BEFORE ? grouped.before : grouped.after;
}

function sameMatch(a: RowMatch | undefined, b: RowMatch): boolean {
  return a !== undefined && a.row === b.row && a.outside === b.outside && a.nth === b.nth;
}

function matchesAt(row: string | Outside, outside: boolean, count: number): RowMatch[] {
  return Array.from({ length: count }, (_, nth) => ({ row, outside, nth }));
}

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
      pending: false,
      drawn: new Map<string, number>(),
      listeners: new Set<(tally: FindTally) => void>(),
      unwatch: undefined as (() => void) | undefined,
    };
    const tell = () => {
      const tally = { count: state.matches.length, at: state.at };
      for (const listener of state.listeners) listener(tally);
    };
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
    const refresh = () => {
      if (state.query.length === 0) return;
      const was = state.matches[state.at];
      const grouped = drawnRanges();
      state.matches = readMatches(grouped);
      const kept =
        was === undefined ? -1 : state.matches.findIndex((match) => sameMatch(was, match));
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
  useEffect(() => find.source.clear, [find]);
  useEffect(() => find.refresh(), [find, input.rows]);
}
