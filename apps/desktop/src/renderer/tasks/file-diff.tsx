import { useAtomValue } from "@effect/atom-react";
import { DIFF_LAYOUT } from "@luke/settings/diff-view";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useCallback, useEffect, useRef, useState } from "react";
import { DIFF_LOAD_FAILED, useSideBundles } from "../bundle-loader";
import type { DiffLook, DiffSelection, DiffViewHandle } from "../diff-view/contract";
import { useFileViewSettings } from "./file-view-settings";

/**
 * file-diff.tsx -- a patch as Luke draws every diff: Pierre's diff (`../diff-view/`) mounted in a File tab's place in Files changed, or in a review thread's card in the overview, laid out and marked as the File tabs' settings say, and unified wherever a split would not fit.
 *
 * The bundle is loaded the first time a diff is shown and mounted once per
 * file; a change of setting or of patch draws the same diff again rather
 * than mounting another. A split diff sets the old side beside the new, so
 * each side has half the room: below `SPLIT_MIN_WIDTH` it is drawn unified
 * whatever the setting says, and the ⋯ offers Split view dimmed, the choice
 * kept for a wider panel.
 */

/** The narrowest a diff is split at, in pixels: each side then holds about forty characters of code beside its numbers. */
const SPLIT_MIN_WIDTH = 640;

/** Whether `element` is wide enough to split a diff in, as it is resized; true before it is measured, so a split is not drawn twice. */
export function useSplitRoom(element: HTMLElement | null): boolean {
  const [roomy, setRoomy] = useState(true);
  useEffect(() => {
    if (element === null) return undefined;
    const measure = () => setRoomy(element.getBoundingClientRect().width >= SPLIT_MIN_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return roomy;
}

/** How the diff settings draw a diff (`file-view-settings.ts`), unified where a split has no room. */
export function useDiffLook(roomy: boolean): DiffLook {
  const { settings } = useFileViewSettings();
  return {
    layout: roomy ? settings.diffLayout : DIFF_LAYOUT.UNIFIED,
    indicators: settings.diffIndicators,
    inlineDiff: settings.inlineDiff,
    backgrounds: settings.diffBackgrounds,
    lineNumbers: settings.lineNumbers,
    wrap: settings.wordWrap,
    themes: { dark: settings.diffDarkTheme, light: settings.diffLightTheme },
    font: settings.diffFont,
    fontSize: settings.diffFontSize,
    lineHeight: settings.diffLineHeight,
    ligatures: settings.diffLigatures,
  };
}

/** Whether two looks draw a diff alike: every setting the same, each appearance's theme among them. */
function sameLook(a: DiffLook, b: DiffLook): boolean {
  return (
    a.layout === b.layout &&
    a.indicators === b.indicators &&
    a.inlineDiff === b.inlineDiff &&
    a.backgrounds === b.backgrounds &&
    a.lineNumbers === b.lineNumbers &&
    a.wrap === b.wrap &&
    a.themes.dark === b.themes.dark &&
    a.themes.light === b.themes.light &&
    a.font === b.font &&
    a.fontSize === b.fontSize &&
    a.lineHeight === b.lineHeight &&
    a.ligatures === b.ligatures
  );
}

/** Whether two selections light the same lines. */
function sameSelection(a: DiffSelection | undefined, b: DiffSelection | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.start === b.start && a.side === b.side && a.end === b.end && a.endSide === b.endSide;
}

/**
 * A file's patch, headed as git writes one, drawn by the diff bundle in
 * `look`, with the lines `selected` lit; while the bundle loads the place
 * stands empty, and where it failed to load it says so.
 */
export function PierreDiff({
  patch,
  look,
  selected,
  excerpt = false,
  className = "file-tab-lines diff-view scroll-fade-top",
  boxRef,
}: {
  patch: string;
  look: DiffLook;
  /** The lines lit, as a review thread's are; none for none. */
  selected?: DiffSelection | undefined;
  /** Whether the patch is a few lines out of a file, drawn with nothing said of the lines around them. */
  excerpt?: boolean;
  /** The box's classes: a File tab's place, filling it and scrolling, unless a card's are given. */
  className?: string;
  /** Handed the box the diff is drawn in, which the view measures for a split's room; a door that stays the same, as a state's setter does. */
  boxRef?: (element: HTMLDivElement | null) => void;
}): React.JSX.Element {
  const loaded = useAtomValue(useSideBundles().diffView);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<DiffViewHandle | undefined>(undefined);
  // What the diff was last drawn with; the mount reads the latest, so it is mounted once.
  const drawn = useRef({ patch, look, selected, excerpt });
  const latest = useRef({ patch, look, selected, excerpt });
  latest.current = { patch, look, selected, excerpt };
  const hostRef = useCallback(
    (element: HTMLDivElement | null) => {
      host.current = element;
      boxRef?.(element);
    },
    [boxRef],
  );

  useEffect(() => {
    const element = host.current;
    if (module === undefined || element === null) return undefined;
    drawn.current = latest.current;
    const mounted = module.mount(element, latest.current);
    handle.current = mounted;
    return () => {
      handle.current = undefined;
      mounted.unmount();
    };
  }, [module]);

  useEffect(() => {
    if (handle.current === undefined) return;
    const was = drawn.current;
    if (
      was.patch === patch &&
      sameLook(was.look, look) &&
      sameSelection(was.selected, selected) &&
      was.excerpt === excerpt
    ) {
      return;
    }
    drawn.current = { patch, look, selected, excerpt };
    handle.current.update({ patch, look, selected, excerpt });
  });

  if (AsyncResult.isFailure(loaded)) {
    return <p className="side-panel-empty">{DIFF_LOAD_FAILED}</p>;
  }
  return <div ref={hostRef} className={className} data-diff-layout={look.layout} />;
}
