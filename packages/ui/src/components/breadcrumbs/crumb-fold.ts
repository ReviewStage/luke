import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { onFontsSettled } from "../../fonts-settled.js";
import { BREADCRUMB_SHOWN, type Crumb } from "./breadcrumbs.js";

const FOLDED_WORDS = "…";
const FOLDED_SEPARATOR = " › ";

interface DrawnCrumb {
  readonly key: string;
  readonly crumb: Crumb;
  readonly legible: boolean;
  readonly whole: boolean;
  readonly folded: boolean;
}

function foldable(crumb: Crumb): boolean {
  return (
    crumb.icon === undefined &&
    crumb.popup === undefined &&
    crumb.kept !== true &&
    crumb.shown !== false &&
    (crumb.shownAt ?? BREADCRUMB_SHOWN.ALWAYS) === BREADCRUMB_SHOWN.ALWAYS
  );
}

function foldableCount(crumbs: readonly Crumb[]): number {
  const last = crumbs.findLastIndex((crumb) => crumb.shown !== false);
  let count = 0;
  while (count < last && foldable(crumbs[count] as Crumb)) count += 1;
  return count;
}

function legible(crumb: Crumb): boolean {
  return crumb.icon === undefined && crumb.popup === undefined;
}

function folded(crumbs: readonly Crumb[], count: number, most: number): readonly DrawnCrumb[] {
  const kept = crumbs
    .map((crumb, at) => {
      const words = legible(crumb);
      return {
        key: String(at),
        crumb,
        legible: words,
        whole: words && count < most,
        folded: false,
      };
    })
    .slice(count);
  if (count === 0) return kept;
  const names = crumbs.slice(0, count).map((crumb) => crumb.label);
  const hint = names.join(FOLDED_SEPARATOR);
  const crumb: Crumb = { label: FOLDED_WORDS, hint, name: hint };
  return [{ key: "folded", crumb, legible: false, whole: false, folded: true }, ...kept];
}

function signature(crumbs: readonly Crumb[]): string {
  return JSON.stringify(crumbs.map((crumb) => [crumb.label, crumb.shown !== false]));
}

function widthsOf(nav: HTMLElement): readonly number[] {
  const widths: number[] = [];
  for (let room = nav.parentElement; room !== null; room = room.parentElement) {
    widths.push(room.clientWidth);
  }
  const list = nav.querySelector("ol");
  if (list === null) return widths;
  widths.push(list.clientWidth, list.scrollWidth);
  for (const crumb of list.children) {
    widths.push(crumb.clientWidth, crumb.querySelector(".ui-breadcrumb-label")?.scrollWidth ?? 0);
  }
  return widths;
}

function sameWidths(one: readonly number[], other: readonly number[]): boolean {
  return one.length === other.length && one.every((width, at) => width === other[at]);
}

function watchCrumbs(observer: ResizeObserver, list: Element, watched: Set<Element>): void {
  const drawn = new Set([list, ...list.children]);
  for (const each of watched) if (!drawn.has(each)) observer.unobserve(each);
  for (const each of drawn) if (!watched.has(each)) observer.observe(each);
  watched.clear();
  for (const each of drawn) watched.add(each);
}

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
  const settled = useRef<readonly number[] | undefined>(undefined);
  const latest = useRef(key);
  latest.current = key;
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
    const was = settled.current;
    if (count > 0 && was !== undefined && !sameWidths(was, widthsOf(nav))) {
      settled.current = undefined;
      setState({ key, count: 0 });
      return;
    }
    if (count < most && list.scrollWidth > list.clientWidth) {
      settled.current = undefined;
      setState({ key, count: count + 1 });
      return;
    }
    settled.current = widthsOf(nav);
  });
  return [attach, folded(crumbs, count, most), crumbs.slice(0, count)];
}
