import type { CodingAgentChangedFile } from "@luke/features/coding-agent-wire";
import { SHORTCUT_KEY, type ShortcutChord } from "@luke/settings/shortcuts";
import { ChevronRightIcon } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Tooltip } from "../tooltip";
import { LinesChanged } from "./agent-published";
import {
  filterFiles,
  STATUS_LETTER,
  STATUS_WORDS,
  startsCollapsed,
  treeOrder,
} from "./changes-model";
import type { DiffListDoor } from "./diff-list";

/**
 * changes-list.tsx -- how Files changed's list of files is walked: which files a filter keeps, which are collapsed, the file the keys stand on, and the keys, stage-cli's, that move between them.
 *
 * The keys are stage-cli's own, a letter alone each: J and K step to the
 * next and the previous file, `;` collapses or expands the file stood on,
 * ⇧; collapses every file the filter keeps, or expands them all once all
 * are collapsed, and Escape lets go of the file stood on. They answer only
 * where the press lands inside Files changed and is not typing, and go no
 * further once answered, so J and K keep their meaning everywhere else in
 * the window (the Inbox's next and previous item, `#shared/shortcuts`), an
 * Escape with no file stood on reaches the window's layers, and the tab's ⌘F
 * is never one of them. The file stood on is outlined in the list and named
 * in the bar; with none stood on, the bar names the file at the top of the
 * list, and a key starts from it.
 *
 * A file's fold is its default, `startsCollapsed`, turned over for the files
 * the developer folded the other way, so a file that starts collapsed and is
 * opened stays open, and Collapse all and Expand all turn over exactly the
 * files the filter keeps. A file the filter leaves out, chosen where every
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

/** The folds turned over, with `paths` folded as `collapsed` says. */
function foldedAs(
  overrides: ReadonlySet<string>,
  files: readonly CodingAgentChangedFile[],
  collapsed: boolean,
): ReadonlySet<string> {
  const next = new Set(overrides);
  for (const file of files) {
    if (startsCollapsed(file) === collapsed) next.delete(file.path);
    else next.add(file.path);
  }
  return next;
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
}

/** Files changed's list over `files`, every fold at its default and no file stood on until the developer acts. */
export function useChangesList(files: readonly CodingAgentChangedFile[]): ChangesList {
  const [query, onQuery] = useState("");
  const [overrides, setOverrides] = useState<ReadonlySet<string>>(new Set());
  const [standing, setStanding] = useState<string | undefined>(undefined);
  const [top, setTop] = useState<string | undefined>(undefined);
  const [sources, setSources] = useState<ReadonlySet<string>>(new Set());
  const door = useRef<DiffListDoor | null>(null);
  const ordered = useMemo(() => treeOrder(files), [files]);
  const kept = useMemo(() => filterFiles(ordered, query), [ordered, query]);
  const paths = useMemo(() => kept.map((file) => file.path), [kept]);
  const folds = useMemo(
    () =>
      new Map(files.map((file) => [file.path, startsCollapsed(file) !== overrides.has(file.path)])),
    [files, overrides],
  );
  const collapsed = useCallback((path: string) => folds.get(path) === true, [folds]);
  const allCollapsed = kept.length > 0 && kept.every((file) => collapsed(file.path));
  const keptStanding = standing !== undefined && paths.includes(standing) ? standing : undefined;
  const current = keptStanding ?? (top !== undefined && paths.includes(top) ? top : paths[0]);

  const toggle = useCallback((path: string) => setOverrides((was) => turned(was, path)), []);
  const asSource = useCallback((path: string) => sources.has(path), [sources]);
  const toggleSource = useCallback((path: string) => setSources((was) => turned(was, path)), []);
  const toggleAll = useCallback(
    () => setOverrides((was) => foldedAs(was, kept, !allCollapsed)),
    [kept, allCollapsed],
  );
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
    // Note that an answered press goes no further, because the window's keymap would run the Inbox's J and K too.
    event.preventDefault();
    event.stopPropagation();
    if (key === FILE_KEY.LET_GO) return setStanding(undefined);
    if (key === FILE_KEY.TOGGLE_ALL) return toggleAll();
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
    onTopFile: setTop,
    go,
    stand: setStanding,
    onKeyDown,
    door,
    asSource,
    toggleSource,
  };
}

/**
 * A file's header in the list, one row: its fold, the letter of what
 * became of it, its path, from the path it moved from where it moved, and
 * the lines it adds and removes, and any control of its own at the end of
 * its row. Pierre keeps it at the top of the list
 * while the file's lines scroll under it, at the height it reserves for it,
 * so nothing more stands in it.
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
  const label = collapsed ? "Expand file" : "Collapse file";
  return (
    <div
      className="diff-list-head"
      data-standing={standing ? "" : undefined}
      data-collapsed={collapsed ? "" : undefined}
      onPointerDown={onStand}
    >
      <div className="diff-list-head-row">
        <Tooltip label={label} chord={FOLD_CHORD.ONE}>
          <button
            type="button"
            className="icon-button diff-list-fold"
            aria-label={label}
            aria-expanded={!collapsed}
            onClick={onToggle}
          >
            <ChevronRightIcon aria-hidden="true" />
          </button>
        </Tooltip>
        <Tooltip label={STATUS_WORDS[file.status]}>
          <span className="file-view-status" data-status={file.status}>
            {STATUS_LETTER[file.status]}
          </span>
        </Tooltip>
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
