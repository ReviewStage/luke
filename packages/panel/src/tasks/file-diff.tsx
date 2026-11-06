import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { DIFF_LAYOUT } from "@repo/settings/diff-view";
import { ERROR_STATE_PLACEMENT, ErrorState } from "@repo/ui";
import { Cause } from "effect";
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
import { failureShown } from "../failure-report.js";
import { useFileViewSettings } from "./file-view-settings.js";

const SPLIT_MIN_WIDTH = 640;

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

function sameSelection(a: DiffSelection | undefined, b: DiffSelection | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.start === b.start && a.side === b.side && a.end === b.end && a.endSide === b.endSide;
}

export interface PierreDiffNote extends DiffAnnotation {
  readonly content: ReactNode;
}

const NO_NOTES: readonly PierreDiffNote[] = [];

function keptNote(held: Map<string, HTMLDivElement>, key: string): HTMLDivElement {
  const kept = held.get(key);
  if (kept !== undefined) return kept;
  const element = document.createElement("div");
  element.className = "diff-note";
  held.set(key, element);
  return element;
}

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
  selected?: DiffSelection | undefined;
  excerpt?: boolean;
  notes?: readonly PierreDiffNote[];
  pooled?: boolean;
  className: string;
}): React.JSX.Element {
  const { diffView } = useSideBundles();
  const loaded = useAtomValue(diffView);
  const retry = useAtomRefresh(diffView);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<DiffViewHandle | undefined>(undefined);
  const elements = useRef(new Map<string, HTMLDivElement>());
  const renderAnnotation = useCallback((key: string) => keptNote(elements.current, key), []);
  const annotations = notes.map(({ key, side, line }) => ({ key, side, line }));
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
      <ErrorState
        failure={failureShown({
          surface: FAILURE_SURFACE.DIFF_READ,
          cause: Cause.squash(loaded.cause),
        })}
        placement={ERROR_STATE_PLACEMENT.CENTERED}
        onRetry={retry}
      >
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
