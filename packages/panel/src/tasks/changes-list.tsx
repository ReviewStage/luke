import type { CodingAgentChangedFile } from "@luke/features/coding-agent-wire";
import {
  FILES_CHANGED_KEY,
  FILES_CHANGED_SHORTCUTS,
  type FilesChangedKey,
  filesChangedKeyFor,
  type ShortcutChord,
  shortcutAria,
} from "@luke/settings/shortcuts";
import { BUTTON_SIZE, IconButton, TextButton } from "@luke/ui";
import { ChevronRightIcon } from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCopyToast } from "../copy-feedback.js";
import { Tooltip } from "../tooltip.js";
import { LinesChanged } from "./agent-published.js";
import {
  filterFiles,
  STATUS_LETTER,
  STATUS_WORDS,
  startsCollapsed,
  treeOrder,
} from "./changes-model.js";
import type { DiffListDoor } from "./diff-list.js";
import { PATH_COPY_WORDS } from "./file-menu.js";

/**
 * changes-list.tsx -- how Files changed's list of files is walked: which files a filter keeps, which are collapsed, the file the keys stand on, and the keys, stage-cli's, that move between them.
 *
 * The keys are stage-cli's own, a letter alone each: J and K step to the
 * next and the previous file, `;` collapses or expands the file stood on,
 * ⇧; collapses every file the filter keeps, or expands them all once all
 * are collapsed, V marks the file stood on viewed on GitHub, or unmarks it,
 * and steps on to the next, I turns Minimize inline comments on or off, as
 * stage-cli's does, ⇧F shows or hides the file tree beside the list,
 * Escape lets go of the file stood on, and `?`
 * opens the sheet that lists them all (`files-changed-keys.tsx`). Each is a
 * row of `@luke/settings/shortcuts`'s Files changed table, which the press is
 * matched against and the sheet and the Keyboard shortcuts page list, so a
 * key listed is a key that answers. They answer only
 * where the press lands inside Files changed and is not typing, and go no
 * further once answered, so J and K keep their meaning everywhere else in
 * the window (the Inbox's next and previous item, `@luke/settings/shortcuts`), an
 * Escape with no file stood on reaches the window's layers, and the tab's ⌘F
 * is never one of them. The file stood on is outlined in the list and named
 * in the bar; with none stood on, the bar names the file at the top of the
 * list, and a key starts from it.
 *
 * A file's fold is the one the developer chose for it, else its default:
 * folded where it `startsCollapsed`, or where the member marked it viewed,
 * as stage-cli folds a viewed file. So a file that starts collapsed and is
 * opened stays open, Collapse all and Expand all fold exactly the files the
 * filter keeps, and marking a file viewed folds it, or unmarking opens it,
 * whatever was chosen for it before. A file the filter leaves out, chosen where every
 * changed file is listed, as the bar's crumbs list them, clears the filter
 * and is scrolled to once the list holds it.
 */

/** The fold keys' chords, for the hints of the controls that do the same. */
export const FOLD_CHORD = {
  ONE: FILES_CHANGED_SHORTCUTS[FILES_CHANGED_KEY.TOGGLE_FILE].chord,
  ALL: FILES_CHANGED_SHORTCUTS[FILES_CHANGED_KEY.TOGGLE_ALL_FILES].chord,
} as const;

/** The key that marks the file stood on viewed, or unmarks it, as GitHub's own V does. */
export const VIEWED_CHORD = FILES_CHANGED_SHORTCUTS[FILES_CHANGED_KEY.MARK_VIEWED].chord;

/** What the list says where a filter keeps no file. */
export const LIST_WORDS = {
  NONE_KEPT: "No changed file's path holds that.",
  FILTERED: "Only files whose path holds",
  CLEAR_FILTER: "Clear filter",
  COLLAPSE_ALL: "Collapse all files",
  EXPAND_ALL: "Expand all files",
  SHOW_SOURCE: "Show source",
  SHOW_IMAGE: "Show image",
  EXPAND_WHOLE: "Expand full file",
  COLLAPSE_TO_CHANGES: "Collapse to changes",
  /** A file that only moved, drawn as its lines. */
  SHOW_FILE: "Show file",
  VIEWED: "Viewed",
  MARK_VIEWED: "Mark as viewed",
  UNMARK_VIEWED: "Mark as not viewed",
  /** How far through the files the member is, as GitHub counts it. */
  viewedOf: (viewed: number, files: number) => `${viewed} / ${files} viewed`,
} as const;

/** Whether the press landed in something taking typing, which keeps its letters. */
export function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

/**
 * Which of the view's keys a press is, or none: a letter read by its
 * character, `;` and `/` by their place, since ⇧ turns them into `:` and `?`
 * (`shortcutMatches`). Note that Escape is the list's only while a file is
 * stood on, because otherwise it is the window's.
 */
function fileKeyOf(event: React.KeyboardEvent, standing: boolean): FilesChangedKey | undefined {
  if (event.defaultPrevented || event.nativeEvent.isComposing) return undefined;
  if (typingInto(event.target)) return undefined;
  const key = filesChangedKeyFor(event);
  return key === FILES_CHANGED_KEY.LET_GO && !standing ? undefined : key;
}

/** The path `step` files on from `from` among `paths`, held at either end; the first for a file not among them. */
function stepped(paths: readonly string[], from: string | undefined, step: number) {
  const at = from === undefined ? -1 : paths.indexOf(from);
  if (at === -1) return paths[0];
  return paths[Math.min(paths.length - 1, Math.max(0, at + step))];
}

/** The paths with `path` turned: taken out where it stood among them, put in where it did not. */
function turned(paths: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const next = new Set(paths);
  if (!next.delete(path)) next.add(path);
  return next;
}

/** The folds the developer chose, with `files` folded as `collapsed` says. */
function foldedAs(
  chosen: ReadonlyMap<string, boolean>,
  files: readonly CodingAgentChangedFile[],
  collapsed: boolean,
): ReadonlyMap<string, boolean> {
  const next = new Map(chosen);
  for (const file of files) next.set(file.path, collapsed);
  return next;
}

/** The fold a path is drawn with: the one the developer chose, else its default. */
function chosenOr(chosen: ReadonlyMap<string, boolean>, path: string, otherwise: boolean): boolean {
  return chosen.get(path) ?? otherwise;
}

/** Which of the files the member marked viewed on GitHub, and the door that marks or unmarks one (`viewed-files.ts`). */
export interface ViewedMarks {
  readonly viewed: (path: string) => boolean;
  /** Marks or unmarks a file, answering once GitHub settled it whether the member's last press for it stands. */
  readonly toggle: (path: string) => Promise<boolean>;
}

/** The list's state and doors: the files kept, each fold, the file stood on and the one at the top, and what the keys and controls do. */
export interface ChangesList {
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly kept: readonly CodingAgentChangedFile[];
  readonly collapsed: (path: string) => boolean;
  readonly allCollapsed: boolean;
  readonly toggle: (path: string) => void;
  /** Opens a file, collapsed or folded as viewed, as a press on its header would, and clears a filter that leaves it out; what a review thread's link does. */
  readonly expand: (path: string) => void;
  readonly toggleAll: () => void;
  /** The file the keys stand on, outlined; none until a key or a choice stands on one. */
  readonly standing: string | undefined;
  /** The file the bar names: the one stood on, else the one at the top of the list. */
  readonly current: string | undefined;
  readonly onTopFile: (path: string) => void;
  /** Stands on a file and scrolls the list to it, as a choice in the tree or a crumb does. */
  readonly go: (path: string) => void;
  /** Stands on a file without scrolling, as a press on its header does. */
  readonly stand: (path: string) => void;
  readonly onKeyDown: (event: React.KeyboardEvent) => void;
  readonly door: RefObject<DiffListDoor | null>;
  /** Whether an image that is text too, an SVG, is drawn as its source's lines rather than as a picture, and the door that turns it. */
  readonly asSource: (path: string) => boolean;
  readonly toggleSource: (path: string) => void;
  /** Whether a file is marked viewed, and the door that marks or unmarks it, which folds or opens it; none while the marks are not read. */
  readonly viewed: ((path: string) => boolean) | undefined;
  readonly markViewed: ((path: string) => void) | undefined;
  /** Whether the sheet of the view's keys, which `?` opens, stands, and the door that puts it away. */
  readonly keysShown: boolean;
  readonly hideKeys: () => void;
}

/** Files changed's list over `files`, every fold at its default and no file stood on until the developer acts. */
export function useChangesList(
  files: readonly CodingAgentChangedFile[],
  marks?: ViewedMarks | undefined,
  /** Turns Minimize inline comments on or off, as I does; none leaves I to the window. */
  onMinimize?: (() => void) | undefined,
  /** Shows or hides the file tree beside the list, as ⇧F does; none leaves ⇧F to the window. */
  onToggleTree?: (() => void) | undefined,
): ChangesList {
  const [query, onQuery] = useState("");
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [standing, setStanding] = useState<string | undefined>(undefined);
  const [top, setTop] = useState<string | undefined>(undefined);
  // Note that the file at the top is kept as the list scrolls but drawn only
  // while no file is stood on, because the bar names the one stood on then,
  // and a draw of the whole view for each file scrolled past is the cost.
  const latestTop = useRef(top);
  // The file stood on among those the filter keeps, which the bar names; set below once the filter is read.
  const standingNow = useRef<string | undefined>(undefined);
  const onTopFile = useCallback((path: string) => {
    latestTop.current = path;
    if (standingNow.current === undefined) setTop(path);
  }, []);
  const letGo = useCallback(() => {
    setTop(latestTop.current);
    setStanding(undefined);
  }, []);
  const [sources, setSources] = useState<ReadonlySet<string>>(new Set());
  const [keysShown, setKeysShown] = useState(false);
  const hideKeys = useCallback(() => setKeysShown(false), []);
  const door = useRef<DiffListDoor | null>(null);
  const ordered = useMemo(() => treeOrder(files), [files]);
  const kept = useMemo(() => filterFiles(ordered, query), [ordered, query]);
  const paths = useMemo(() => kept.map((file) => file.path), [kept]);
  const viewed = marks?.viewed;
  const folds = useMemo(
    () =>
      new Map(
        files.map((file) => [
          file.path,
          chosenOr(chosen, file.path, startsCollapsed(file) || viewed?.(file.path) === true),
        ]),
      ),
    [files, chosen, viewed],
  );
  const collapsed = useCallback((path: string) => folds.get(path) === true, [folds]);
  const allCollapsed = kept.length > 0 && kept.every((file) => collapsed(file.path));
  const keptStanding = standing !== undefined && paths.includes(standing) ? standing : undefined;
  standingNow.current = keptStanding;
  const current = keptStanding ?? (top !== undefined && paths.includes(top) ? top : paths[0]);

  // How many times each file's fold was chosen, so a press undone puts back only a fold nothing chose since.
  const foldChoices = useRef(new Map<string, number>());
  const choose = useCallback((paths: readonly string[]) => {
    for (const path of paths)
      foldChoices.current.set(path, (foldChoices.current.get(path) ?? 0) + 1);
  }, []);
  const latestFolds = useRef(folds);
  latestFolds.current = folds;
  const latestPaths = useRef(paths);
  latestPaths.current = paths;
  // Note that the doors a file's header holds stay the same doors across
  // draws, reading the folds and the marks as they stand, so a header the
  // view keeps from its last draw still turns its file as it is now.
  const toggle = useCallback(
    (path: string) => {
      choose([path]);
      setChosen((was) => new Map(was).set(path, latestFolds.current.get(path) !== true));
    },
    [choose],
  );
  const expand = useCallback(
    (path: string) => {
      if (!latestPaths.current.includes(path)) onQuery("");
      if (latestFolds.current.get(path) !== true) return;
      choose([path]);
      setChosen((was) => new Map(was).set(path, false));
    },
    [choose],
  );
  // A file marked viewed folds, and one unmarked opens, whatever was chosen for it before, which comes back where GitHub would not take the press.
  const latestMarks = useRef({ marks, chosen });
  latestMarks.current = { marks, chosen };
  const markViewed = useCallback(
    (path: string) => {
      const { marks, chosen } = latestMarks.current;
      if (marks === undefined) return;
      const before = chosen.get(path);
      const folding = !marks.viewed(path);
      choose([path]);
      const choice = foldChoices.current.get(path);
      setChosen((was) => new Map(was).set(path, folding));
      void marks.toggle(path).then((stood) => {
        if (stood || foldChoices.current.get(path) !== choice) return;
        setChosen((was) => {
          const next = new Map(was);
          if (before === undefined) next.delete(path);
          else next.set(path, before);
          return next;
        });
      });
    },
    [choose],
  );
  const asSource = useCallback((path: string) => sources.has(path), [sources]);
  const toggleSource = useCallback((path: string) => setSources((was) => turned(was, path)), []);
  const latestAll = useRef({ kept, allCollapsed });
  latestAll.current = { kept, allCollapsed };
  // Note that the door stays the same door across draws, as a header's others do, reading the files kept and their folds as they stand.
  const toggleAll = useCallback(() => {
    const { kept, allCollapsed } = latestAll.current;
    choose(kept.map((file) => file.path));
    setChosen((was) => foldedAs(was, kept, !allCollapsed));
  }, [choose]);
  // A file the filter leaves out is chosen in the tree's crumbs, which list every changed file: the filter is cleared, and the list scrolled to it once it holds it again.
  const [revealing, setRevealing] = useState<string | undefined>(undefined);
  const go = useCallback(
    (path: string) => {
      setStanding(path);
      if (paths.includes(path)) return door.current?.reveal(path);
      onQuery("");
      setRevealing(path);
    },
    [paths],
  );
  useEffect(() => {
    if (revealing === undefined || !paths.includes(revealing)) return;
    setRevealing(undefined);
    door.current?.reveal(revealing);
  }, [revealing, paths]);

  // A first press stands on the file at the top rather than stepping past it.
  const stepFrom = (path: string, step: number) => {
    const next = keptStanding === undefined ? path : stepped(paths, path, step);
    go(next ?? path);
  };
  const onFile = (run: (path: string) => void) =>
    current === undefined ? undefined : () => run(current);
  // What each of the view's keys does as the list stands, none where it has
  // nothing to act on: every key but `?` and ⇧F needs a file to stand on, V
  // the marks read, I a Minimize inline comments to turn, and ⇧F a tree. Note that the record is total over the table, so a key
  // added to the table does not build until it is handled here.
  const keyRuns = () =>
    ({
      [FILES_CHANGED_KEY.NEXT_FILE]: onFile((path) => stepFrom(path, 1)),
      [FILES_CHANGED_KEY.PREVIOUS_FILE]: onFile((path) => stepFrom(path, -1)),
      [FILES_CHANGED_KEY.TOGGLE_FILE]: onFile((path) => {
        toggle(path);
        go(path);
      }),
      [FILES_CHANGED_KEY.TOGGLE_ALL_FILES]: onFile(toggleAll),
      [FILES_CHANGED_KEY.LET_GO]: onFile(letGo),
      // The file marked folds, and the keys step on to the next, so pressing V again marks it.
      [FILES_CHANGED_KEY.MARK_VIEWED]:
        marks === undefined
          ? undefined
          : onFile((path) => {
              markViewed(path);
              stepFrom(path, 1);
            }),
      [FILES_CHANGED_KEY.MINIMIZE_COMMENTS]:
        onMinimize === undefined ? undefined : onFile(() => onMinimize()),
      [FILES_CHANGED_KEY.SHOW_SHORTCUTS]: () => setKeysShown(true),
      [FILES_CHANGED_KEY.TOGGLE_TREE]: onToggleTree,
    }) satisfies Record<FilesChangedKey, (() => void) | undefined>;
  const onKeyDown = (event: React.KeyboardEvent) => {
    const key = fileKeyOf(event, keptStanding !== undefined);
    const run = key === undefined ? undefined : keyRuns()[key];
    if (run === undefined) return;
    // Note that an answered press goes no further, because the window's keymap would run the Inbox's J and K too.
    event.preventDefault();
    event.stopPropagation();
    run();
  };

  return {
    query,
    onQuery,
    kept,
    collapsed,
    allCollapsed,
    toggle,
    expand,
    toggleAll,
    standing: keptStanding,
    current,
    onTopFile,
    go,
    stand: setStanding,
    onKeyDown,
    door,
    asSource,
    toggleSource,
    viewed: marks?.viewed,
    markViewed: marks === undefined ? undefined : markViewed,
    keysShown,
    hideKeys,
  };
}

/** What a file's header says and hints. */
const HEAD_WORDS = {
  EXPAND: "Expand file",
  COLLAPSE: "Collapse file",
  ALL_HINT: "\u2325-click for all files",
} as const;

/** What on a header's row keeps its press for itself rather than folding the file. */
const HEAD_CONTROLS = "button, a, input, label, summary, [role='button'], [role='checkbox']";

/** A path as a header names it: its folder, quiet, then its name. */
function PathParts({ path }: { path: string }): React.JSX.Element {
  const cut = path.lastIndexOf("/") + 1;
  return (
    <>
      {cut === 0 ? null : (
        <span className="diff-list-folder">
          <bdi>{path.slice(0, cut)}</bdi>
        </span>
      )}
      <span className="diff-list-name">
        <bdi>{path.slice(cut)}</bdi>
      </span>
    </>
  );
}

/** A pointer arriving over a control, as the window says it. */
function pointerOver(): PointerEvent {
  return new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" });
}

/**
 * A file's header in the list, one row: its fold, the letter of what
 * became of it, its path, from the path it moved from where it moved, and
 * the lines it adds and removes, and any control of its own at the end of
 * its row. Pierre keeps it at the top of the list
 * while the file's lines scroll under it, at the height it reserves for it,
 * so nothing more stands in it.
 *
 * Its two hints, the fold's and the letter's, are mounted the first time
 * the pointer or the keyboard comes to the header, because a list of
 * hundreds of files would otherwise mount two for every one of them up
 * front. Mounting them draws the fold anew, so where the keyboard's arrival
 * on the fold is what mounted them, the fold takes the focus back.
 */
export function FileHead({
  file,
  controls,
  collapsed,
  standing,
  onToggle,
  onToggleAll,
  onStand,
}: {
  file: CodingAgentChangedFile;
  /** The file's own controls, at the end of its row; none for none. */
  controls?: ReactNode;
  collapsed: boolean;
  /** Whether the keys stand on the file, which outlines it. */
  standing: boolean;
  onToggle: () => void;
  /** Folds every file the filter keeps, or unfolds them all, as ⌥ and a press on the fold do. */
  onToggleAll: () => void;
  onStand: () => void;
}): React.JSX.Element {
  const copy = useCopyToast();
  const [near, setNear] = useState(false);
  // The header's hinted parts, in order: its fold, its letter, the path it moved from, and its path.
  const parts = useRef<(HTMLElement | null)[]>([]);
  const partAt = (at: number) => (element: HTMLElement | null) => {
    parts.current[at] = element;
  };
  // Which part brought the hints: the keyboard's focus on one, or the pointer over one.
  const arrived = useRef<{ readonly focused: number; readonly over: number }>({
    focused: -1,
    over: -1,
  });
  useLayoutEffect(() => {
    if (!near) return;
    const { focused, over } = arrived.current;
    const focusable = (at: number) => {
      const part = parts.current[at];
      return part?.matches("button") === true ? part : part?.querySelector("button");
    };
    if (focused !== -1) focusable(focused)?.focus();
    // Note that the part the pointer is already on is told so again, because the one drawn in its place has heard no arrival.
    if (over !== -1) (focusable(over) ?? parts.current[over])?.dispatchEvent(pointerOver());
  }, [near]);
  const partOf = (target: EventTarget) =>
    target instanceof Node
      ? parts.current.findIndex((part) => part?.contains(target) === true)
      : -1;
  const label = collapsed ? HEAD_WORDS.EXPAND : HEAD_WORDS.COLLAPSE;
  const hinted = (
    hint: string,
    part: ComponentProps<typeof Tooltip>["children"],
    chord?: ShortcutChord,
  ) =>
    near ? (
      <Tooltip label={hint} chord={chord}>
        {part}
      </Tooltip>
    ) : (
      part
    );
  const fold = (
    <IconButton
      ref={partAt(0)}
      icon={<ChevronRightIcon className="diff-list-fold" aria-hidden="true" />}
      label={label}
      size={BUTTON_SIZE.COMPACT}
      aria-expanded={!collapsed}
      aria-keyshortcuts={shortcutAria(FOLD_CHORD.ONE)}
      onClick={(event) => (event.altKey ? onToggleAll() : onToggle())}
    />
  );
  const letter = (
    <span ref={partAt(1)} className="file-view-status" data-status={file.status}>
      {STATUS_LETTER[file.status]}
    </span>
  );
  const pathCopy = (path: string, at: number, words: string, hint: string, moved: boolean) => (
    <span ref={partAt(at)} className="diff-list-path-part" data-moved={moved ? "" : undefined}>
      {hinted(
        hint,
        <TextButton aria-label={`${hint}: ${path}`} onClick={() => copy(path, words)}>
          <PathParts path={path} />
        </TextButton>,
      )}
    </span>
  );
  return (
    <div
      className="diff-list-head"
      data-standing={standing ? "" : undefined}
      data-collapsed={collapsed ? "" : undefined}
      onPointerDown={onStand}
      onPointerEnter={(event) => {
        if (near) return;
        arrived.current = { focused: -1, over: partOf(event.target) };
        setNear(true);
      }}
      onFocusCapture={(event) => {
        if (near) return;
        arrived.current = { focused: partOf(event.target), over: -1 };
        setNear(true);
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a press anywhere on the row folds the file as its fold does, which is the control the keyboard reaches. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the fold beside it is the row's keyboard control, and ; folds the file stood on. */}
      <div
        className="diff-list-head-row"
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest(HEAD_CONTROLS) !== null) {
            return;
          }
          onToggle();
        }}
      >
        {hinted(`${label} \u00b7 ${HEAD_WORDS.ALL_HINT}`, fold, FOLD_CHORD.ONE)}
        {hinted(STATUS_WORDS[file.status], letter)}
        <span className="diff-list-path">
          {file.previousPath === null ? (
            pathCopy(file.path, 3, PATH_COPY_WORDS.PATH_COPIED, PATH_COPY_WORDS.COPY_PATH, false)
          ) : (
            <>
              {pathCopy(
                file.previousPath,
                2,
                PATH_COPY_WORDS.PATH_COPIED,
                PATH_COPY_WORDS.COPY_OLD_PATH,
                true,
              )}
              <span className="diff-list-folder" aria-hidden="true">
                {"\u00a0\u2192\u00a0"}
              </span>
              {pathCopy(
                file.path,
                3,
                PATH_COPY_WORDS.PATH_COPIED,
                PATH_COPY_WORDS.COPY_NEW_PATH,
                false,
              )}
            </>
          )}
        </span>
        <LinesChanged additions={file.additions} deletions={file.deletions} />
        {controls}
      </div>
    </div>
  );
}
