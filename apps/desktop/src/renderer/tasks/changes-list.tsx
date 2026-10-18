import type { CodingAgentChangedFile } from "@luke/features/coding-agent-wire";
import {
  filterFiles,
  STATUS_LETTER,
  STATUS_WORDS,
  startsCollapsed,
  treeOrder,
} from "@luke/panel/tasks/changes-model";
import { SHORTCUT_KEY, type ShortcutChord, shortcutAria } from "@luke/settings/shortcuts";
import { IconButton } from "@luke/ui";
import { ChevronRightIcon } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Tooltip } from "../tooltip";
import { LinesChanged } from "./agent-published";
import type { DiffListDoor } from "./diff-list";

/**
 * changes-list.tsx -- how Files changed's list of files is walked: which files a filter keeps, which are collapsed, the file the keys stand on, and the keys, stage-cli's, that move between them.
 *
 * The keys are stage-cli's own, a letter alone each: J and K step to the
 * next and the previous file, `;` collapses or expands the file stood on,
 * ⇧; collapses every file the filter keeps, or expands them all once all
 * are collapsed, V marks the file stood on viewed on GitHub, or unmarks it,
 * and steps on to the next, and Escape lets go of the file stood on. They answer only
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

/** What a key does in the list. */
const FILE_KEY = {
  NEXT: "next",
  PREVIOUS: "previous",
  TOGGLE: "toggle",
  TOGGLE_ALL: "toggle-all",
  LET_GO: "let-go",
  VIEWED: "viewed",
} as const;

type FileKey = (typeof FILE_KEY)[keyof typeof FILE_KEY];

/** The fold keys' chords, for the hints of the controls that do the same. */
export const FOLD_CHORD = {
  ONE: { key: SHORTCUT_KEY.SEMICOLON, plain: true },
  ALL: { key: SHORTCUT_KEY.SEMICOLON, plain: true, shift: true },
} as const satisfies Record<string, ShortcutChord>;

/** What the list says where a filter keeps no file. */
export const LIST_WORDS = {
  NONE_KEPT: "No changed file's path holds that.",
  FILTERED: "Only files whose path holds",
  CLEAR_FILTER: "Clear filter",
  COLLAPSE_ALL: "Collapse all files",
  EXPAND_ALL: "Expand all files",
  SHOW_SOURCE: "Show source",
  SHOW_IMAGE: "Show image",
  VIEWED: "Viewed",
  /** How far through the files the member is, as GitHub counts it. */
  viewedOf: (viewed: number, files: number) => `${viewed} / ${files} viewed`,
} as const;

/** Whether the press landed in something taking typing, which keeps its letters. */
function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

/**
 * What a press does in the list, or nothing: a letter alone, or ⇧ with `;`,
 * read by its key for J and K and by its place for `;`, which ⇧ turns into
 * `:` on most keyboards. Note that Escape is the list's only while a file is
 * stood on, because otherwise it is the window's.
 */
function fileKeyOf(event: React.KeyboardEvent, standing: boolean): FileKey | undefined {
  if (event.defaultPrevented || event.nativeEvent.isComposing) return undefined;
  if (event.metaKey || event.ctrlKey || event.altKey || typingInto(event.target)) return undefined;
  if (event.key === "Escape") return standing ? FILE_KEY.LET_GO : undefined;
  if (event.code === "Semicolon") return event.shiftKey ? FILE_KEY.TOGGLE_ALL : FILE_KEY.TOGGLE;
  if (event.shiftKey) return undefined;
  const key = event.key.toLowerCase();
  if (key === "j") return FILE_KEY.NEXT;
  if (key === "v") return FILE_KEY.VIEWED;
  return key === "k" ? FILE_KEY.PREVIOUS : undefined;
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
}

/** Files changed's list over `files`, every fold at its default and no file stood on until the developer acts. */
export function useChangesList(
  files: readonly CodingAgentChangedFile[],
  marks?: ViewedMarks | undefined,
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
  const toggleAll = useCallback(() => {
    choose(kept.map((file) => file.path));
    setChosen((was) => foldedAs(was, kept, !allCollapsed));
  }, [kept, allCollapsed, choose]);
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

  const onKeyDown = (event: React.KeyboardEvent) => {
    const key = fileKeyOf(event, keptStanding !== undefined);
    if (key === undefined || current === undefined) return;
    // V is the list's only while the marks are read, so there is something to mark.
    if (key === FILE_KEY.VIEWED && marks === undefined) return;
    // Note that an answered press goes no further, because the window's keymap would run the Inbox's J and K too.
    event.preventDefault();
    event.stopPropagation();
    if (key === FILE_KEY.LET_GO) return letGo();
    if (key === FILE_KEY.TOGGLE_ALL) return toggleAll();
    if (key === FILE_KEY.VIEWED) {
      // The file marked folds, and the keys step on to the next, so pressing V again marks it.
      markViewed(current);
      const next = keptStanding === undefined ? current : stepped(paths, current, 1);
      return go(next ?? current);
    }
    if (key === FILE_KEY.TOGGLE) {
      toggle(current);
      return go(current);
    }
    // A first press stands on the file at the top rather than stepping past it.
    const step = key === FILE_KEY.NEXT ? 1 : -1;
    const next = keptStanding === undefined ? current : stepped(paths, current, step);
    if (next !== undefined) go(next);
  };

  return {
    query,
    onQuery,
    kept,
    collapsed,
    allCollapsed,
    toggle,
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
  };
}

/** A pointer arriving over a control, as the window would say it; a window with no pointer events says it as a mouse's. */
function pointerOver(): Event {
  const init = { bubbles: true, pointerType: "mouse" };
  return typeof PointerEvent === "function"
    ? new PointerEvent("pointerover", init)
    : new MouseEvent("pointerover", init);
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
  onStand,
}: {
  file: CodingAgentChangedFile;
  /** The file's own controls, at the end of its row; none for none. */
  controls?: ReactNode;
  collapsed: boolean;
  /** Whether the keys stand on the file, which outlines it. */
  standing: boolean;
  onToggle: () => void;
  onStand: () => void;
}): React.JSX.Element {
  const [near, setNear] = useState(false);
  const foldRef = useRef<HTMLButtonElement>(null);
  const letterRef = useRef<HTMLSpanElement>(null);
  // What brought the hints: the keyboard's focus on the fold, or the pointer on the fold or the letter.
  const arrived = useRef({ focused: false, overFold: false, overLetter: false });
  useLayoutEffect(() => {
    if (!near) return;
    const { focused, overFold, overLetter } = arrived.current;
    if (focused) foldRef.current?.focus();
    // Note that the control the pointer is already on is told so again, because the one drawn in its place has heard no arrival.
    if (overFold) foldRef.current?.dispatchEvent(pointerOver());
    if (overLetter) letterRef.current?.dispatchEvent(pointerOver());
  }, [near]);
  const label = collapsed ? "Expand file" : "Collapse file";
  const fold = (
    <IconButton
      ref={foldRef}
      icon={<ChevronRightIcon className="diff-list-fold" aria-hidden="true" />}
      label={label}
      aria-expanded={!collapsed}
      aria-keyshortcuts={shortcutAria(FOLD_CHORD.ONE)}
      onClick={onToggle}
    />
  );
  const letter = (
    <span ref={letterRef} className="file-view-status" data-status={file.status}>
      {STATUS_LETTER[file.status]}
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
        const { target } = event;
        const on = (control: HTMLElement | null) =>
          target instanceof Node && control?.contains(target) === true;
        arrived.current = {
          focused: false,
          overFold: on(foldRef.current),
          overLetter: on(letterRef.current),
        };
        setNear(true);
      }}
      onFocusCapture={(event) => {
        if (near) return;
        arrived.current = {
          focused: foldRef.current?.contains(event.target) === true,
          overFold: false,
          overLetter: false,
        };
        setNear(true);
      }}
    >
      <div className="diff-list-head-row">
        {near ? (
          <Tooltip label={label} chord={FOLD_CHORD.ONE}>
            {fold}
          </Tooltip>
        ) : (
          fold
        )}
        {near ? <Tooltip label={STATUS_WORDS[file.status]}>{letter}</Tooltip> : letter}
        <span className="diff-list-path">
          {file.previousPath === null ? null : (
            <>
              <bdi>{file.previousPath}</bdi> →{" "}
            </>
          )}
          <bdi>{file.path}</bdi>
        </span>
        <LinesChanged additions={file.additions} deletions={file.deletions} />
        {controls}
      </div>
    </div>
  );
}
