import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { onFontsSettled } from "../../fonts-settled.js";
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
 * folds before it is painted, and again from nothing whenever its crumbs
 * change or any width the fold was settled on moves: the room the path
 * stands in, the list, a crumb, or the words once the page's fonts load.
 * Note that a fold is undone only by measuring again from nothing, so a
 * width the fold does not watch would leave the path folded or cut as it
 * stood at whichever moment it was last measured.
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
  /** Whether it is the "…" standing for the crumbs folded away. */
  readonly folded: boolean;
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
    .map((crumb, at) => ({ key: String(at), crumb, legible: legible(crumb), folded: false }))
    .slice(count);
  if (count === 0) return kept;
  const names = crumbs.slice(0, count).map((crumb) => crumb.label);
  const hint = names.join(FOLDED_SEPARATOR);
  // Note that the "…" is no legible crumb, because its floor is its own width.
  const crumb: Crumb = { label: FOLDED_WORDS, hint, name: hint };
  return [{ key: "folded", crumb, legible: false, folded: true }, ...kept];
}

/** What identifies a path for the fold: its words and which are drawn, so a renamed or arriving crumb is measured afresh. */
function signature(crumbs: readonly Crumb[]): string {
  return JSON.stringify(crumbs.map((crumb) => [crumb.label, crumb.shown !== false]));
}

/**
 * Every width a fold settles on, read from the path's landmark: each box it
 * stands in up to the page, its list's room and need, and each crumb's
 * width and its words' whole width. Note that the same crumbs folded the
 * same way read the same widths, so a measure from nothing that ends where
 * it began reads no change.
 */
function widthsOf(nav: HTMLElement): readonly number[] {
  const widths: number[] = [];
  for (let room = nav.parentElement; room !== null; room = room.parentElement) {
    widths.push(room.clientWidth);
  }
  const list = nav.querySelector("ol");
  if (list === null) return widths;
  widths.push(list.clientWidth, list.scrollWidth);
  for (const crumb of list.children) {
    widths.push(crumb.clientWidth, crumb.querySelector(".luke-breadcrumb-label")?.scrollWidth ?? 0);
  }
  return widths;
}

/** Whether two readings of a path's widths are the same. */
function sameWidths(one: readonly number[], other: readonly number[]): boolean {
  return one.length === other.length && one.every((width, at) => width === other[at]);
}

/** Watches the list and each crumb drawn now, and lets go of the crumbs no longer drawn. */
function watchCrumbs(observer: ResizeObserver, list: Element, watched: Set<Element>): void {
  const drawn = new Set([list, ...list.children]);
  for (const each of watched) if (!drawn.has(each)) observer.unobserve(each);
  for (const each of drawn) if (!watched.has(each)) observer.observe(each);
  watched.clear();
  for (const each of drawn) watched.add(each);
}

/**
 * The crumbs to draw, the ones folded away, and the ref of the bar holding
 * them: `nav` is the path's landmark, whose list is measured. A host with no
 * resize observer lays nothing out, so its path never folds.
 */
export function useCrumbFold(
  crumbs: readonly Crumb[],
): [
  (nav: HTMLElement | null) => (() => void) | undefined,
  readonly DrawnCrumb[],
  readonly Crumb[],
] {
  const key = signature(crumbs);
  const [state, setState] = useState({ key, count: 0 });
  const count = state.key === key ? state.count : 0;
  const most = foldableCount(crumbs);
  const bar = useRef<HTMLElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const watched = useRef(new Set<Element>());
  // Note that the widths stand unset while a fold is under way, so a resize between its steps measures nothing.
  const settled = useRef<readonly number[] | undefined>(undefined);
  const latest = useRef(key);
  latest.current = key;
  // Note that every box the path stands in is watched, up to the page, because
  // the one around it is as wide as the folded path and so never grows to say
  // that the window did; the first with room of its own does.
  const attach = useCallback((nav: HTMLElement | null): (() => void) | undefined => {
    if (nav === null || typeof ResizeObserver === "undefined") return undefined;
    bar.current = nav;
    const remeasure = () => {
      const was = settled.current;
      if (was === undefined || sameWidths(was, widthsOf(nav))) return;
      settled.current = undefined;
      setState({ key: latest.current, count: 0 });
    };
    const resized = new ResizeObserver(remeasure);
    observer.current = resized;
    for (let room = nav.parentElement; room !== null; room = room.parentElement) {
      resized.observe(room);
    }
    const stopFonts = onFontsSettled(remeasure);
    return () => {
      bar.current = null;
      observer.current = null;
      watched.current.clear();
      resized.disconnect();
      stopFonts();
    };
  }, []);
  useLayoutEffect(() => {
    const nav = bar.current;
    const list = nav?.querySelector("ol");
    if (nav === null || nav === undefined || list === null || list === undefined) return;
    if (observer.current !== null) watchCrumbs(observer.current, list, watched.current);
    if (count < most && list.scrollWidth > list.clientWidth) {
      settled.current = undefined;
      setState({ key, count: count + 1 });
      return;
    }
    settled.current = widthsOf(nav);
  });
  return [attach, folded(crumbs, count), crumbs.slice(0, count)];
}
