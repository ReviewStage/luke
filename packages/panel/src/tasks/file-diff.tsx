import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { DIFF_LAYOUT } from "@luke/settings/diff-view";
import { ERROR_STATE_PLACEMENT, ErrorState } from "@luke/ui";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DIFF_LOAD_FAILED, useSideBundles } from "../bundle-loader.js";
import {
  type DiffAnnotation,
  type DiffLook,
  type DiffSelection,
  type DiffViewHandle,
  type DiffViewProps,
  sameLook,
  sameNotes,
} from "../diff-view/contract.js";
import { useFileViewSettings } from "./file-view-settings.js";

/**
 * file-diff.tsx -- a patch as Luke draws every diff: Pierre's diff (`../diff-view/`) mounted in a review thread's card in the overview, laid out and marked as the File tabs' settings say, and unified wherever a split would not fit.
 *
 * Files changed draws its files as a list through the same bundle
 * (`diff-list.tsx`), in the same look and room. The bundle is loaded the
 * first time a diff is shown and mounted once per diff; a change of setting
 * or of patch draws the same diff again rather than mounting another. A
 * split diff sets the old side beside the new, so
 * each side has half the room: below `SPLIT_MIN_WIDTH` it is drawn unified
 * whatever the setting says, and the ⋯ offers Split view dimmed, the choice
 * kept for a wider panel. A note under a line of the patch, Luke's on a
 * Code card's snippet, is drawn by React into an element the diff keeps for
 * it, which Pierre stands under its line.
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

/** Whether two selections light the same lines. */
function sameSelection(a: DiffSelection | undefined, b: DiffSelection | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.start === b.start && a.side === b.side && a.end === b.end && a.endSide === b.endSide;
}

/** A note under a line of a patch: where it stands, by its key, and what React draws in it. */
export interface PierreDiffNote extends DiffAnnotation {
  readonly content: ReactNode;
}

/** No notes. */
const NO_NOTES: readonly PierreDiffNote[] = [];

/** What the diff stands its notes in: the element kept for each key, made the first time it is asked for. */
function keptNote(held: Map<string, HTMLDivElement>, key: string): HTMLDivElement {
  const kept = held.get(key);
  if (kept !== undefined) return kept;
  const element = document.createElement("div");
  element.className = "diff-note";
  held.set(key, element);
  return element;
}

/**
 * A file's patch, headed as git writes one, drawn by the diff bundle in
 * `look`, with the lines `selected` lit and each of `notes` under its line;
 * while the bundle loads the place stands empty, and where it failed to
 * load it says so.
 */
export function PierreDiff({
  patch,
  look,
  selected,
  excerpt = false,
  notes = NO_NOTES,
  pooled = false,
  className,
}: {
  patch: string;
  look: DiffLook;
  /** The lines lit, as a review thread's are; none for none. */
  selected?: DiffSelection | undefined;
  /** Whether the patch is a few lines out of a file, drawn with nothing said of the lines around them. */
  excerpt?: boolean;
  /** What stands under the patch's lines; none where absent. */
  notes?: readonly PierreDiffNote[];
  /** Whether it is coloured off the window's thread, as one of many drawn at once; read as it is mounted. */
  pooled?: boolean;
  /** The box's classes, a card's. */
  className: string;
}): React.JSX.Element {
  const { diffView } = useSideBundles();
  const loaded = useAtomValue(diffView);
  const retry = useAtomRefresh(diffView);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<DiffViewHandle | undefined>(undefined);
  // Note that each note's element is kept for the diff's life, because Pierre stands the same element again as it draws the patch anew.
  const elements = useRef(new Map<string, HTMLDivElement>());
  const renderAnnotation = useCallback((key: string) => keptNote(elements.current, key), []);
  const annotations = notes.map(({ key, side, line }) => ({ key, side, line }));
  // What the diff was last drawn with; the mount reads the latest, so it is mounted once.
  const props: DiffViewProps = {
    patch,
    look,
    selected,
    excerpt,
    annotations,
    renderAnnotation,
    pooled,
  };
  const drawn = useRef(props);
  const latest = useRef(props);
  latest.current = props;
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
      was.excerpt === excerpt &&
      sameNotes(was.annotations ?? NO_NOTES, annotations)
    ) {
      return;
    }
    drawn.current = latest.current;
    handle.current.update(latest.current);
  });

  if (AsyncResult.isFailure(loaded)) {
    return (
      <ErrorState placement={ERROR_STATE_PLACEMENT.CENTRED} onRetry={retry}>
        {DIFF_LOAD_FAILED}
      </ErrorState>
    );
  }
  return (
    <div ref={host} className={className} data-diff-layout={look.layout}>
      {notes.map((note) =>
        createPortal(note.content, keptNote(elements.current, note.key), note.key),
      )}
    </div>
  );
}
