import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useCallback, useEffect, useRef, useState } from "react";
import { DIFF_LAYOUT, type DiffLook, type DiffViewHandle } from "../diff-view/contract";
import { DIFF_LOAD_FAILED, diffViewModuleAtom } from "./diff-view-bundle";
import { useFileViewSettings } from "./file-view-settings";

/**
 * file-diff.tsx -- one changed file's patch as the Files changed view draws it: Pierre's diff (`../diff-view/`) mounted in a File tab's place, laid out and marked as the File tabs' settings say, and unified wherever a split would not fit.
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

/** How the File tabs' settings draw a diff, unified where a split has no room. */
export function useDiffLook(roomy: boolean): DiffLook {
  const { settings } = useFileViewSettings();
  return {
    layout: roomy ? settings.diffLayout : DIFF_LAYOUT.UNIFIED,
    changedWords: settings.changedWords,
    lineNumbers: settings.lineNumbers,
    wrap: settings.wordWrap,
  };
}

/** Whether two looks draw a diff alike. */
function sameLook(a: DiffLook, b: DiffLook): boolean {
  return (
    a.layout === b.layout &&
    a.changedWords === b.changedWords &&
    a.lineNumbers === b.lineNumbers &&
    a.wrap === b.wrap
  );
}

/**
 * A file's patch, headed as git writes one, drawn by the diff bundle in
 * `look`; while the bundle loads the place stands empty, and where it
 * failed to load it says so.
 */
export function PierreDiff({
  patch,
  look,
  boxRef,
}: {
  patch: string;
  look: DiffLook;
  /** Handed the box the diff is drawn in, which the view measures for a split's room; a door that stays the same, as a state's setter does. */
  boxRef?: (element: HTMLDivElement | null) => void;
}): React.JSX.Element {
  const loaded = useAtomValue(diffViewModuleAtom);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<DiffViewHandle | undefined>(undefined);
  // What the diff was last drawn with; the mount reads the latest, so it is mounted once.
  const drawn = useRef({ patch, look });
  const latest = useRef({ patch, look });
  latest.current = { patch, look };
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
    if (drawn.current.patch === patch && sameLook(drawn.current.look, look)) return;
    drawn.current = { patch, look };
    handle.current.update({ patch, look });
  });

  if (AsyncResult.isFailure(loaded)) {
    return <p className="side-panel-empty">{DIFF_LOAD_FAILED}</p>;
  }
  return (
    <div
      ref={hostRef}
      className="file-tab-lines diff-view scroll-fade-top"
      data-diff-layout={look.layout}
    />
  );
}
