import { useAtomValue } from "@effect/atom-react";
import { DIFF_LOAD_FAILED, useSideBundles } from "@luke/panel/bundle-loader";
import {
  type DiffAnnotation,
  type DiffFileTexts,
  type DiffListFile,
  type DiffListHandle,
  type DiffListProps,
  type DiffListSelection,
  type DiffLook,
  GAP_LINES,
  sameListSelection,
  sameLook,
  sameNotes,
} from "@luke/panel/diff-view/contract";
import { TooltipPill } from "@luke/ui";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import {
  Fragment,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

/**
 * diff-list.tsx -- a pull request's files as Files changed draws them: one list, every file under a header of its own, drawn by Pierre's list (`../diff-view/`'s `mountList`), only the files near the view drawn at all.
 *
 * The bundle is loaded the first time a diff is shown and the list mounted
 * once; new files, a file collapsed or expanded, and a change of setting
 * draw the same list again rather than mounting another. Each file's header
 * and each note are drawn here, into an element kept for the list's life by
 * the file's path and the note's key, which the bundle stands at the head of
 * the file and under its line, so a header and a note are this window's own
 * React and stylesheets. The view is told the file whose header stands at
 * the top as the list scrolls, and scrolls the list to a file through
 * `door`. Where the view comments on lines, the gutter's + tells it the
 * lines picked (`onComment`), and the lines it is commenting on stand lit
 * (`selected`).
 */

/** A note drawn in a file of the list, a review thread's under its line or what stands above the file's first hunk: where it stands, and what it says. */
export interface DiffNote extends DiffAnnotation {
  readonly content: ReactNode;
}

/** One file of the list as the view hands it: its path, its patch, whether it is collapsed, whether its notes stand in the place of its lines, its header, and its notes. */
export interface DiffListEntry {
  readonly path: string;
  readonly patch: string;
  readonly collapsed: boolean;
  readonly lead: boolean;
  /** Whether the lines between its hunks may be opened. */
  readonly expandable: boolean;
  readonly header: ReactNode;
  readonly notes: readonly DiffNote[];
}

/** What the view does to the list once it is drawn: scrolls it to a file's header. */
export interface DiffListDoor {
  readonly reveal: (path: string) => void;
}

/** What a gap's arrow says it does: the next lines of a long gap, the whole of a short one, or every line of the gap. */
const GAP_WORDS = {
  MORE: `Show ${GAP_LINES} more lines`,
  ALL_CHORD: "\u21e7-click for all",
  THESE: "Show these lines",
  EVERY: "Show all these lines",
} as const;

/** The hint over a gap's arrow under the pointer: the arrow, and what it says. */
interface GapHint {
  readonly anchor: HTMLElement;
  readonly label: string;
  readonly chord: string | undefined;
}

/**
 * The hint for the arrow of a gap the pointer arrived on, inside a file's
 * shadow root, where the pointer's path leads; none for anything else. A
 * long gap draws an arrow for the next lines and keeps Expand all beside
 * it, which ⇧ does too; a short one opens whole.
 */
function gapHintOf(path: readonly EventTarget[]): GapHint | undefined {
  const anchor = path.find(
    (target): target is HTMLElement =>
      target instanceof HTMLElement && target.hasAttribute("data-expand-button"),
  );
  if (anchor === undefined) return undefined;
  if (anchor.hasAttribute("data-expand-all-button")) {
    return { anchor, label: GAP_WORDS.EVERY, chord: undefined };
  }
  const long =
    anchor.closest("[data-separator-wrapper]")?.querySelector("[data-expand-all-button]") != null;
  return long
    ? { anchor, label: GAP_WORDS.MORE, chord: GAP_WORDS.ALL_CHORD }
    : { anchor, label: GAP_WORDS.THESE, chord: undefined };
}

/** A note's place alone, which is all the bundle is handed of it. */
function placeOf({ key, side, line }: DiffAnnotation): DiffAnnotation {
  return { key, side, line };
}

/**
 * Each entry as the bundle is handed it, made once for the entry, so a
 * draw that keeps an entry hands the bundle the very file it was handed
 * before, which is the same at a glance.
 */
const LIST_FILES = new WeakMap<DiffListEntry, DiffListFile>();

/** An entry as the bundle is handed it: its place, patch, fold, and its notes' places. */
function listFileOf(entry: DiffListEntry): DiffListFile {
  const kept = LIST_FILES.get(entry);
  if (kept !== undefined) return kept;
  const file = {
    path: entry.path,
    patch: entry.patch,
    collapsed: entry.collapsed,
    lead: entry.lead,
    expandable: entry.expandable,
    annotations: entry.notes.map(placeOf),
  };
  LIST_FILES.set(entry, file);
  return file;
}

/** Whether two lists of files draw alike: the same files in the same order, each with the same patch, fold, and notes. */
function sameFiles(a: readonly DiffListFile[], b: readonly DiffListFile[]): boolean {
  return (
    a.length === b.length &&
    a.every((file, at) => {
      const other = b[at];
      return (
        file === other ||
        (other !== undefined &&
          file.path === other.path &&
          file.patch === other.patch &&
          file.collapsed === other.collapsed &&
          file.lead === other.lead &&
          file.expandable === other.expandable &&
          sameNotes(file.annotations, other.annotations))
      );
    })
  );
}

/** The element kept by `key` in `held`, made with `className` the first time it is asked for. */
function keptElement(held: Map<string, HTMLDivElement>, key: string, className: string) {
  const kept = held.get(key);
  if (kept !== undefined) return kept;
  const element = document.createElement("div");
  element.className = className;
  held.set(key, element);
  return element;
}

/**
 * The files of `entries` drawn as one list in `look`, in a box that fills
 * the File tab's place and scrolls; while the bundle loads the place stands
 * empty, and where it failed to load it says so.
 */
export function PierreDiffList({
  entries,
  look,
  door,
  onTopFile,
  boxRef,
  onComment,
  selected,
  readTexts,
}: {
  entries: readonly DiffListEntry[];
  look: DiffLook;
  /** Filled with what scrolls the list once it is drawn, emptied when it is taken down. */
  door: RefObject<DiffListDoor | null>;
  /** Told the path of the file whose header stands at the top of the list as it scrolls. */
  onTopFile: (path: string) => void;
  /** Handed the box the list is drawn in, which the view measures for a split's room; a door that stays the same, as a state's setter does. */
  boxRef: (element: HTMLDivElement | null) => void;
  /** Told the lines a press of the gutter's + picked; none offers no +. */
  onComment?: ((picked: DiffListSelection) => void) | undefined;
  /** The lines being commented on, lit. */
  selected?: DiffListSelection | undefined;
  /** Reads a file whole, the first time the lines between its hunks are asked for; none offers none. */
  readTexts?: ((path: string) => Promise<DiffFileTexts | undefined>) | undefined;
}): React.JSX.Element {
  const loaded = useAtomValue(useSideBundles().diffView);
  // The hint over the gap arrow under the pointer, which Pierre draws in a shadow root no hint of the window's own reaches.
  const [hint, setHint] = useState<GapHint | undefined>(undefined);
  const hintId = useId();
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<DiffListHandle | undefined>(undefined);
  // Note that each header and note is drawn into an element of its own, kept
  // for the list's life, because Pierre stands the same element again when
  // a file scrolls back into view.
  const headers = useRef(new Map<string, HTMLDivElement>());
  const notes = useRef(new Map<string, Map<string, HTMLDivElement>>());
  const renderHeader = useCallback(
    (path: string) => keptElement(headers.current, path, "diff-list-head-slot"),
    [],
  );
  const renderAnnotation = useCallback((path: string, key: string) => {
    const file = notes.current.get(path) ?? new Map<string, HTMLDivElement>();
    notes.current.set(path, file);
    return keptElement(file, key, "diff-note");
  }, []);
  const topFile = useRef(onTopFile);
  topFile.current = onTopFile;
  const tellTop = useCallback((path: string) => topFile.current(path), []);
  const comment = useRef(onComment);
  comment.current = onComment;
  const tellComment = useCallback((picked: DiffListSelection) => comment.current?.(picked), []);
  const texts = useRef(readTexts);
  texts.current = readTexts;
  const askTexts = useCallback(
    (path: string) => texts.current?.(path) ?? Promise.resolve(undefined),
    [],
  );
  const files = entries.map(listFileOf);
  const props: DiffListProps = {
    files,
    look,
    renderHeader,
    renderAnnotation,
    onTopFile: tellTop,
    onComment: onComment === undefined ? undefined : tellComment,
    selected,
    readTexts: readTexts === undefined ? undefined : askTexts,
  };
  // What the list was last drawn with; the mount reads the latest, so it is mounted once.
  const drawn = useRef(props);
  const latest = useRef(props);
  latest.current = props;
  const hostRef = useCallback(
    (element: HTMLDivElement | null) => {
      host.current = element;
      boxRef(element);
    },
    [boxRef],
  );

  useEffect(() => {
    const element = host.current;
    if (module === undefined || element === null) return undefined;
    drawn.current = latest.current;
    const mounted = module.mountList(element, latest.current);
    handle.current = mounted;
    door.current = { reveal: (path) => mounted.reveal(path) };
    return () => {
      door.current = null;
      handle.current = undefined;
      mounted.unmount();
    };
  }, [module, door]);

  useEffect(() => {
    if (handle.current === undefined) return;
    const was = drawn.current;
    if (
      sameFiles(was.files, files) &&
      sameLook(was.look, look) &&
      sameListSelection(was.selected, selected) &&
      (was.onComment === undefined) === (onComment === undefined) &&
      (was.readTexts === undefined) === (readTexts === undefined)
    )
      return;
    drawn.current = latest.current;
    handle.current.update(latest.current);
  });

  if (AsyncResult.isFailure(loaded)) {
    return <p className="side-panel-empty">{DIFF_LOAD_FAILED}</p>;
  }
  return (
    <div
      ref={hostRef}
      className="file-tab-lines diff-view diff-list"
      data-diff-layout={look.layout}
      onPointerOver={(event) => {
        const next = gapHintOf(event.nativeEvent.composedPath());
        setHint((was) => (was?.anchor === next?.anchor ? was : next));
      }}
      onPointerLeave={() => setHint(undefined)}
      onPointerDown={() => setHint(undefined)}
    >
      {hint === undefined ? null : (
        <TooltipPill
          id={hintId}
          anchor={hint.anchor}
          instant={false}
          label={hint.label}
          shortcut={
            hint.chord === undefined ? undefined : (
              <span className="tooltip-chord">{hint.chord}</span>
            )
          }
        />
      )}
      {entries.map((entry) => (
        <Fragment key={entry.path}>
          {createPortal(entry.header, renderHeader(entry.path))}
          {entry.notes.map((note) =>
            createPortal(note.content, renderAnnotation(entry.path, note.key), note.key),
          )}
        </Fragment>
      ))}
    </div>
  );
}
