import type { AgentChangedFile } from "@repo/features/agent-wire";
import {
  FILES_CHANGED_KEY,
  FILES_CHANGED_SHORTCUTS,
  type FilesChangedKey,
  filesChangedKeyFor,
  type ShortcutChord,
  shortcutAria,
} from "@repo/settings/shortcuts";
import {
  BUTTON_SIZE,
  DISCLOSURE_FILL,
  DISCLOSURE_SUMMARY,
  Disclosure,
  DisclosureFrame,
  DisclosureSummary,
  IconButton,
  OneLine,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  TextButton,
  Tooltip,
} from "@repo/ui";
import { ChevronRightIcon } from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { coarsePointerNow } from "../coarse-pointer.js";
import { useCopyToast } from "../copy-feedback.js";
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
import { fileName } from "./file-ref-model.js";
import { FileTypeIcon } from "./file-type-icon.js";

export const FOLD_CHORD = {
  ONE: FILES_CHANGED_SHORTCUTS[FILES_CHANGED_KEY.TOGGLE_FILE].chord,
  ALL: FILES_CHANGED_SHORTCUTS[FILES_CHANGED_KEY.TOGGLE_ALL_FILES].chord,
} as const;

export const VIEWED_CHORD = FILES_CHANGED_SHORTCUTS[FILES_CHANGED_KEY.MARK_VIEWED].chord;

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
  SHOW_FILE: "Show file",
  LOAD_DIFF: "Load diff",
  VIEWED: "Viewed",
  MARK_VIEWED: "Mark as viewed",
  UNMARK_VIEWED: "Mark as not viewed",
} as const;

export function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

function fileKeyOf(event: React.KeyboardEvent, standing: boolean): FilesChangedKey | undefined {
  if (event.defaultPrevented || event.nativeEvent.isComposing) return undefined;
  if (typingInto(event.target)) return undefined;
  const key = filesChangedKeyFor(event);
  return key === FILES_CHANGED_KEY.LET_GO && !standing ? undefined : key;
}

function stepped(paths: readonly string[], from: string | undefined, step: number) {
  const at = from === undefined ? -1 : paths.indexOf(from);
  if (at === -1) return paths[0];
  return paths[Math.min(paths.length - 1, Math.max(0, at + step))];
}

function turned(paths: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const next = new Set(paths);
  if (!next.delete(path)) next.add(path);
  return next;
}

function foldedAs(
  chosen: ReadonlyMap<string, boolean>,
  files: readonly AgentChangedFile[],
  collapsed: boolean,
): ReadonlyMap<string, boolean> {
  const next = new Map(chosen);
  for (const file of files) next.set(file.path, collapsed);
  return next;
}

function chosenOr(chosen: ReadonlyMap<string, boolean>, path: string, otherwise: boolean): boolean {
  return chosen.get(path) ?? otherwise;
}

export interface ViewedMarks {
  readonly viewed: (path: string) => boolean;
  readonly toggle: (path: string) => Promise<boolean>;
}

export interface ChangesList {
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly kept: readonly AgentChangedFile[];
  readonly collapsed: (path: string) => boolean;
  readonly allCollapsed: boolean;
  readonly toggle: (path: string) => void;
  readonly expand: (path: string) => void;
  readonly toggleAll: () => void;
  readonly standing: string | undefined;
  readonly current: string | undefined;
  readonly onTopFile: (path: string) => void;
  readonly go: (path: string) => void;
  readonly stand: (path: string) => void;
  readonly onKeyDown: (event: React.KeyboardEvent) => void;
  readonly door: RefObject<DiffListDoor | null>;
  readonly asSource: (path: string) => boolean;
  readonly toggleSource: (path: string) => void;
  readonly viewed: ((path: string) => boolean) | undefined;
  readonly markViewed: ((path: string) => void) | undefined;
  readonly keysShown: boolean;
  readonly hideKeys: () => void;
}

export function useChangesList(
  files: readonly AgentChangedFile[],
  marks?: ViewedMarks | undefined,
  onMinimize?: (() => void) | undefined,
  onToggleTree?: (() => void) | undefined,
): ChangesList {
  const [query, onQuery] = useState("");
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [standing, setStanding] = useState<string | undefined>(undefined);
  const [top, setTop] = useState<string | undefined>(undefined);
  const latestTop = useRef(top);
  const standingNow = useRef<string | undefined>(undefined);
  const onTopFile = useCallback((path: string) => {
    latestTop.current = path;
    if (standingNow.current === undefined) startTransition(() => setTop(path));
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

  const foldChoices = useRef(new Map<string, number>());
  const choose = useCallback((paths: readonly string[]) => {
    for (const path of paths)
      foldChoices.current.set(path, (foldChoices.current.get(path) ?? 0) + 1);
  }, []);
  const latestFolds = useRef(folds);
  latestFolds.current = folds;
  const latestPaths = useRef(paths);
  latestPaths.current = paths;
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
  const toggleAll = useCallback(() => {
    const { kept, allCollapsed } = latestAll.current;
    choose(kept.map((file) => file.path));
    setChosen((was) => foldedAs(was, kept, !allCollapsed));
  }, [choose]);
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

  const stepFrom = (path: string, step: number) => {
    const next = keptStanding === undefined ? path : stepped(paths, path, step);
    go(next ?? path);
  };
  const onFile = (run: (path: string) => void) =>
    current === undefined ? undefined : () => run(current);
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

const HEAD_WORDS = {
  EXPAND: "Expand file",
  COLLAPSE: "Collapse file",
  ALL_HINT: "\u2325-click for all files",
} as const;

function PathParts({ path }: { path: string }): React.JSX.Element {
  const cut = path.lastIndexOf("/") + 1;
  return (
    <>
      {cut === 0 ? null : (
        <OneLine className="diff-list-folder text-muted-foreground" words={path.slice(0, cut)}>
          <bdi>{path.slice(0, cut)}</bdi>
        </OneLine>
      )}
      <OneLine
        className="diff-list-name max-w-full flex-none font-ui-medium group-data-moved/part:text-muted-foreground group-data-moved/part:[font-weight:inherit]"
        words={path.slice(cut)}
      >
        <bdi>{path.slice(cut)}</bdi>
      </OneLine>
    </>
  );
}

function pointerOver(): PointerEvent {
  return new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" });
}

export function FileHead({
  file,
  controls,
  collapsed,
  standing,
  onToggle,
  onToggleAll,
  onStand,
}: {
  file: AgentChangedFile;
  controls?: ReactNode;
  collapsed: boolean;
  standing: boolean;
  onToggle: () => void;
  onToggleAll: () => void;
  onStand: () => void;
}): React.JSX.Element {
  const copy = useCopyToast();
  const [near, setNear] = useState(coarsePointerNow);
  const parts = useRef<(HTMLElement | null)[]>([]);
  const partAt = (at: number) => (element: HTMLElement | null) => {
    parts.current[at] = element;
  };
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
      icon={
        <ChevronRightIcon
          className="rotate-90 group-data-collapsed/head:rotate-0"
          aria-hidden="true"
        />
      }
      label={label}
      size={BUTTON_SIZE.COMPACT}
      aria-expanded={!collapsed}
      aria-keyshortcuts={shortcutAria(FOLD_CHORD.ONE)}
      onClick={(event) => (event.altKey ? onToggleAll() : onToggle())}
    />
  );
  const letter = (
    <span
      ref={partAt(1)}
      className="file-view-status inline-flex h-ui-16 flex-none items-center justify-center rounded-ui-6 bg-status-letter font-mono text-caption-inline font-ui-semibold text-attention data-[status=added]:text-complete data-[status=deleted]:text-danger data-[status=renamed]:text-working"
      data-status={file.status}
    >
      {STATUS_LETTER[file.status]}
    </span>
  );
  const pathCopy = (path: string, at: number, words: string, hint: string, moved: boolean) => (
    <span
      ref={partAt(at)}
      className="diff-list-path-part group/part flex min-w-0 data-moved:flex-initial data-moved:text-muted-foreground"
      data-moved={moved ? "" : undefined}
    >
      {hinted(
        hint,
        <TextButton aria-label={`${hint}: ${path}`} onClick={() => copy(path, words)}>
          <span className="diff-list-path-words flex min-w-0">
            <PathParts path={path} />
          </span>
        </TextButton>,
      )}
    </span>
  );
  return (
    <div
      className="diff-list-head group/head cursor-default bg-surface font-sans text-foreground"
      data-standing={standing ? "" : undefined}
      data-collapsed={collapsed ? "" : undefined}
      onPointerEnter={(event) => {
        if (near || event.pointerType === "touch") return;
        arrived.current = { focused: -1, over: partOf(event.target) };
        setNear(true);
      }}
      onFocusCapture={(event) => {
        if (near) return;
        arrived.current = { focused: partOf(event.target), over: -1 };
        setNear(true);
      }}
    >
      <DisclosureFrame
        fill={DISCLOSURE_FILL.ACTIONS}
        lead={hinted(`${label} \u00b7 ${HEAD_WORDS.ALL_HINT}`, fold, FOLD_CHORD.ONE)}
        actions={
          <>
            <span className="flex min-w-0 flex-initial font-mono">
              {file.previousPath === null ? (
                pathCopy(
                  file.path,
                  3,
                  PATH_COPY_WORDS.PATH_COPIED,
                  PATH_COPY_WORDS.COPY_PATH,
                  false,
                )
              ) : (
                <>
                  {pathCopy(
                    file.previousPath,
                    2,
                    PATH_COPY_WORDS.PATH_COPIED,
                    PATH_COPY_WORDS.COPY_OLD_PATH,
                    true,
                  )}
                  <Text
                    as={TEXT_ELEMENT.SPAN}
                    variant={TEXT_VARIANT.INHERIT}
                    truncate
                    className="diff-list-folder text-muted-foreground"
                    aria-hidden="true"
                  >
                    {"\u00a0\u2192\u00a0"}
                  </Text>
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
          </>
        }
        onPointerDown={onStand}
      >
        <Disclosure open={!collapsed} onOpenChange={onToggle}>
          <DisclosureSummary
            look={DISCLOSURE_SUMMARY.ROW}
            aria-label={
              file.previousPath === null
                ? `${STATUS_WORDS[file.status]} ${file.path}`
                : `${STATUS_WORDS[file.status]} ${file.previousPath} to ${file.path}`
            }
          >
            {hinted(STATUS_WORDS[file.status], letter)}
            <FileTypeIcon name={fileName(file.path)} />
          </DisclosureSummary>
        </Disclosure>
      </DisclosureFrame>
    </div>
  );
}
