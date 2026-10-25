import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { BREADCRUMB_SHOWN, type Crumb } from "./breadcrumbs.js";

/**
 * crumb-fold.ts -- a path that does not fit its bar leaves its first crumbs out as one "…", the way a crumb squeezes to two letters never reads.
 *
 * A crumb gives way by its share down to a floor the stylesheet keeps
 * legible; a path whose crumbs at their floors still overflow its bar folds
 * the crumbs at its start into a single "…" crumb, one more at a time, until
 * what is left fits, the last crumb, the page the reader stands on, always
 * standing. Only a crumb of words or a plain press may be folded: one that
 * opens something, a glyph that is the toolbar's way back, and one a bar's
 * widths already stand in for (`shownAt`) are the caller's own folds, and
 * the fold stops short of them.
 *
 * The bar is measured in the layout effect after each render, so the path
 * folds before it is painted, and again from nothing whenever the room the
 * path stands in resizes or its crumbs change.
 */

/** What the folded crumbs are called, hung on the "…" that stands for them. */
const FOLDED_WORDS = "…";
const FOLDED_SEPARATOR = " › ";

/** One crumb of the drawn path, keyed by its place in the path the caller wrote. */
interface DrawnCrumb {
  readonly key: string;
  readonly crumb: Crumb;
  /** Whether it keeps its words legible in a narrow bar, so the fold comes before it shrinks to its first letters. */
  readonly legible: boolean;
}

/** Whether a crumb may be left out of a narrow path: words or a plain press, always drawn. */
function foldable(crumb: Crumb): boolean {
  return (
    crumb.icon === undefined &&
    crumb.popup === undefined &&
    crumb.shown !== false &&
    (crumb.shownAt ?? BREADCRUMB_SHOWN.ALWAYS) === BREADCRUMB_SHOWN.ALWAYS
  );
}

/** How many crumbs at the path's start may be folded: its leading foldable crumbs, never the last one drawn. */
function foldableCount(crumbs: readonly Crumb[]): number {
  const last = crumbs.findLastIndex((crumb) => crumb.shown !== false);
  let count = 0;
  while (count < last && foldable(crumbs[count] as Crumb)) count += 1;
  return count;
}

/** Whether a crumb of the path the caller wrote keeps its words legible: not the way back, and not one a press opens something from, which the caller folds as it sees fit. */
function legible(crumb: Crumb): boolean {
  return crumb.icon === undefined && crumb.popup === undefined;
}

/** The path as drawn with its first `count` crumbs folded into one "…" that names them. */
function folded(crumbs: readonly Crumb[], count: number): readonly DrawnCrumb[] {
  const kept = crumbs
    .map((crumb, at) => ({ key: String(at), crumb, legible: legible(crumb) }))
    .slice(count);
  if (count === 0) return kept;
  const names = crumbs.slice(0, count).map((crumb) => crumb.label);
  const hint = names.join(FOLDED_SEPARATOR);
  // Note that the "…" is no legible crumb, because its floor is its own width.
  const crumb: Crumb = { label: FOLDED_WORDS, hint, name: hint };
  return [{ key: "folded", crumb, legible: false }, ...kept];
}

/** What identifies a path for the fold: its words and which are drawn, so a renamed or arriving crumb is measured afresh. */
function signature(crumbs: readonly Crumb[]): string {
  return JSON.stringify(crumbs.map((crumb) => [crumb.label, crumb.shown !== false]));
}

/**
 * The crumbs to draw and the ref of the bar holding them: `nav` is the path's
 * landmark, whose list is measured. A host with no resize observer lays
 * nothing out, so its path never folds.
 */
export function useCrumbFold(
  crumbs: readonly Crumb[],
): [(nav: HTMLElement | null) => (() => void) | undefined, readonly DrawnCrumb[]] {
  const key = signature(crumbs);
  const [state, setState] = useState({ key, count: 0 });
  const count = state.key === key ? state.count : 0;
  const most = foldableCount(crumbs);
  const bar = useRef<HTMLElement | null>(null);
  const latest = useRef(key);
  latest.current = key;
  // Note that the room the path stands in is what is watched, not the path, whose own width changes as it folds.
  const attach = useCallback((nav: HTMLElement | null): (() => void) | undefined => {
    if (nav === null || typeof ResizeObserver === "undefined") return undefined;
    bar.current = nav;
    const room = nav.parentElement;
    if (room === null) return undefined;
    let width = room.clientWidth;
    const resized = new ResizeObserver(() => {
      if (room.clientWidth === width) return;
      width = room.clientWidth;
      setState({ key: latest.current, count: 0 });
    });
    resized.observe(room);
    return () => {
      bar.current = null;
      resized.disconnect();
    };
  }, []);
  useLayoutEffect(() => {
    const list = bar.current?.querySelector("ol");
    if (list === null || list === undefined || count >= most) return;
    if (list.scrollWidth > list.clientWidth) setState({ key, count: count + 1 });
  });
  return [attach, folded(crumbs, count)];
}
