import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { TaskCode, TaskCodeShowing, TasksTreeAnswer } from "@luke/features/tasks-view";
import { ArrowLeftIcon, ArrowRightIcon, ProviderMark, SidePanelIcon } from "@luke/ui";
import { shownFiles } from "@luke/voice/code-pane-model";
import {
  Fragment,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { paneTiming } from "../desktop/pane-motion";
import type { ReadFolder } from "../file-tree/contract";
import { Tooltip } from "../tooltip";
import { FileBreadcrumbs } from "./file-breadcrumbs";
import { FileMenu } from "./file-menu";
import type { FileNotes } from "./file-note";
import { FileTab, type ReadFileWindow } from "./file-tab";
import {
  FILE_READ,
  type FileRead,
  fileUrl,
  notesOf,
  shortCommit,
  WHOLE_TEXT,
  type WholeText,
  wholeTextOf,
} from "./file-tab-model";
import { FileTreePane } from "./file-tree-pane";
import { keptListings, type ListFolder, listingOf } from "./folder-listings";
import { FILE_HISTORY_STEP, type FileHistoryStep, type OpenFile } from "./use-side-panel";

/**
 * file-view.tsx -- a File tab with the plan's repository beside it: one bar across both, the file under it, and the collapsible tree on its right.
 *
 * The bar is the whole view's, the tree's column included, as an editor's
 * is: Back and Forward through the files this tab showed, the file's path
 * as breadcrumbs, then at its end the file opened on GitHub, the ⋯ of what
 * is done with it (`file-menu.tsx`), and the tree's toggle, the side
 * panel's own glyph, since the tree is docked on the right as the panel
 * is, and slides in and out as the panel does (`useTreeSlide`). The tab
 * under it reads the file and tells the bar how the read stands, which is
 * what the GitHub button and the menu offer by. The breadcrumbs are words
 * in the window's own type, as a tab's name is; only the file is code.
 *
 * The tree and the breadcrumbs both browse the repository the file was
 * read from, listed through one store of what the panel has listed
 * (`folder-listings.ts`). A file chosen in either is shown in this tab, or
 * in a tab of its own where ⌘ was held, by the panel's own rule of one tab
 * per file (`use-side-panel.ts`); a folder opens in place in either, the
 * breadcrumb's tree being the same tree, rooted where the crumb stands. The
 * tree is open or closed for every File tab alike, as the
 * panel holds it, and stands across them, since the tab beside it is keyed
 * by its file and the tree is not. A plan with no repository draws the tab
 * alone, its path plain in the bar. A file opened at a commit, as an inbox
 * item's code or a snippet Luke read from his checkout opens it, is read at
 * that commit, its GitHub page and its copy too, the commit named quietly
 * beside the path, and drawn afresh when the same file is opened at another.
 *
 * In a side panel too narrow for the file and the tree side by side, the
 * tree stands over the file's right edge instead, shut until its toggle
 * opens it for this tab alone (`usePaneRoom`), and the crumbs fold what
 * the bar has no room for (`file-breadcrumbs.tsx`).
 *
 * The bar and the tree's slide are an agent's Changes tab's too
 * (`agent-changes-tab.tsx`), so a diff stands under the same bar, its file's
 * path as breadcrumbs, the pull request on GitHub, its ⋯, and the same
 * toggle of the same tree.
 */

/** What a pane's toggle says while the pane is open, and while it is not. */
interface ToggleWords {
  readonly open: string;
  readonly closed: string;
}

const FILES_TOGGLE: ToggleWords = { open: "Hide files", closed: "Show files" };

/** Where a toggle opens its pane: beside the tab, as the panel holds it, or over the tab, where the panel is too narrow for the two side by side. */
const PANE_PLACE = { BESIDE: "beside", OVER: "over" } as const;

type PanePlace = (typeof PANE_PLACE)[keyof typeof PANE_PLACE];

/** One of a pane's toggles: the pane open or shut in its place, as `open` says. */
function PlaceToggle({
  place,
  open,
  onToggle,
  words,
}: {
  place: PanePlace;
  open: boolean;
  onToggle: () => void;
  words: ToggleWords;
}): React.JSX.Element {
  const label = open ? words.open : words.closed;
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className="icon-button file-tree-toggle"
        aria-label={label}
        aria-expanded={open}
        data-open={String(open)}
        data-place={place}
        onClick={onToggle}
      >
        <SidePanelIcon />
      </button>
    </Tooltip>
  );
}

/** A pane's toggles as its room hands them (`usePaneRoom`): beside the tab, as the panel holds it, and over it. */
export interface PaneToggles {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly over: boolean;
  readonly onToggleOver: () => void;
}

/**
 * The toggle at a bar's end that opens and closes the pane beside the tab:
 * a File tab's tree, or a Terminal tab's shells. It is drawn once for each
 * place the pane can stand, and the stylesheet shows the one the panel's
 * width leaves room for (`@container side-panel`), so a press always opens
 * the pane where it is seen.
 */
export function TreeToggle({
  toggles,
  words = FILES_TOGGLE,
}: {
  toggles: PaneToggles;
  words?: ToggleWords;
}): React.JSX.Element {
  return (
    <>
      <PlaceToggle
        place={PANE_PLACE.BESIDE}
        open={toggles.open}
        onToggle={toggles.onToggle}
        words={words}
      />
      <PlaceToggle
        place={PANE_PLACE.OVER}
        open={toggles.over}
        onToggle={toggles.onToggleOver}
        words={words}
      />
    </>
  );
}

/** The tree as the view draws it: whether it is drawn, whether on its way out, and its box. */
interface TreeSlide {
  drawn: boolean;
  leaving: boolean;
  pane: RefObject<HTMLElement | null>;
}

/**
 * The tree shown and hidden as a pane is (docs/DESIGN.md): it lands in the
 * layout or leaves it at once, so the file takes or gives its room on the
 * frame the toggle is pressed and moves no more, and the tree slides in
 * from the view's right edge, or out past it over the file it uncovers,
 * on the pane's own motion tokens. Each slide starts from wherever one
 * under way had brought it. A closed tree is held drawn through its slide
 * out and let go once it has played; with no motion to play, under reduced
 * motion or a capture run, it is let go before the frame is drawn. The tree
 * a File tab opens with stands at once, since nothing was toggled.
 */
function useTreeSlide(open: boolean): TreeSlide {
  const pane = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);
  if (shown !== open) {
    setShown(open);
    setLeaving(!open);
  }
  const last = useRef(open);
  useLayoutEffect(() => {
    const element = pane.current;
    if (last.current === open || element === null) return;
    last.current = open;
    const timing = paneTiming(element);
    // Note that the slide under way is read before it is stopped, because
    // the next one starts from where it had brought the tree, and that it is
    // stopped even with no motion to play, because an exit's fill would
    // otherwise hold a tree shown again past the edge.
    const from = getComputedStyle(element).transform;
    for (const running of element.getAnimations()) running.cancel();
    if (timing === undefined) {
      if (!open) setLeaving(false);
      return;
    }
    if (open) {
      const start = from === "none" ? "translateX(100%)" : from;
      element.animate([{ transform: start }, { transform: "none" }], timing);
      return;
    }
    const exit = element.animate([{ transform: from }, { transform: "translateX(100%)" }], {
      ...timing,
      fill: "forwards",
    });
    exit.onfinish = () => setLeaving(false);
  }, [open]);
  return { drawn: open || leaving, leaving, pane };
}

/** A pane beside a tab, a File tab's tree or a Terminal tab's shells, wherever the panel's width lets it stand. */
export interface PaneRoom {
  /** The pane beside the tab, open or shut as the panel holds it for every tab of its kind. */
  readonly beside: TreeSlide;
  /** Whether the pane is drawn at all, beside the tab or over it. */
  readonly drawn: boolean;
  readonly toggles: PaneToggles;
  /** Takes down the pane standing over the tab, as a file chosen in it does. */
  readonly closeOver: () => void;
  /** What the view's root wears: the marks the stylesheet places the pane by, and Escape anywhere in the view, its bar's toggle included, taking down the pane standing over the tab. */
  readonly root: {
    readonly "data-pane-beside": string;
    readonly "data-pane-over": string;
    readonly onKeyDown: (event: React.KeyboardEvent) => void;
  };
  /** What the box the pane stands in wears: a press beside the pane standing over the tab takes it down. */
  readonly body: { readonly onPointerDown: (event: React.PointerEvent) => void };
}

/**
 * The pane's room. Beside the tab it is open or shut as the panel holds it
 * (`useTreeSlide`); where the panel is too narrow for the tab and the pane
 * side by side (`@container side-panel`), the stylesheet draws it over the
 * tab's right edge instead, shut until its own toggle opens it, and only
 * for this tab, since a pane opened over a tab is a glance rather than a
 * layout. Which of the two places is drawn is the stylesheet's alone, so
 * the panel crossing its width moves the pane without a render.
 */
export function usePaneRoom(shown: {
  readonly open: boolean;
  readonly onToggle: () => void;
}): PaneRoom {
  const beside = useTreeSlide(shown.open);
  const [over, setOver] = useState(false);
  const closeOver = useCallback(() => setOver(false), []);
  const { pane } = beside;
  return {
    beside,
    drawn: beside.drawn || over,
    toggles: { ...shown, over, onToggleOver: () => setOver((was) => !was) },
    closeOver,
    root: {
      "data-pane-beside": String(beside.drawn),
      "data-pane-over": String(over),
      onKeyDown: (event) => {
        if (!over || event.key !== "Escape" || event.nativeEvent.isComposing) return;
        // Note that the Escape is stopped here, because the window's own would leave the view.
        event.stopPropagation();
        setOver(false);
      },
    },
    body: {
      onPointerDown: (event) => {
        if (!over || !(event.target instanceof Node) || pane.current?.contains(event.target))
          return;
        setOver(false);
      },
    },
  };
}

/** A File tab's history as its bar walks it: whether each way holds a file, and the step. */
export interface FileHistory {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly onStep: (step: FileHistoryStep) => void;
}

/**
 * Back and Forward through the files this tab showed, as the sidebar's own
 * pair is drawn: a way with nothing along it is dimmed rather than gone, so
 * neither button moves.
 */
function HistoryButtons({ history }: { history: FileHistory }): React.JSX.Element {
  return (
    <div className="file-view-history">
      <Tooltip label="Back">
        <button
          type="button"
          className="icon-button"
          aria-label="Back"
          disabled={!history.canGoBack}
          onClick={() => history.onStep(FILE_HISTORY_STEP.BACK)}
        >
          <ArrowLeftIcon />
        </button>
      </Tooltip>
      <Tooltip label="Forward">
        <button
          type="button"
          className="icon-button"
          aria-label="Forward"
          disabled={!history.canGoForward}
          onClick={() => history.onStep(FILE_HISTORY_STEP.FORWARD)}
        >
          <ArrowRightIcon />
        </button>
      </Tooltip>
    </div>
  );
}

/** The path the bar names, and the repository it browses, whose folders its breadcrumbs list; none names the path plain. */
export interface BarPath {
  readonly path: string;
  readonly browse:
    | {
        readonly repository: string;
        readonly listFolder: ReadFolder;
        /** A file chosen in a crumb's tree, to show in the tab, or in a tab of its own where `newTab` asks. */
        readonly onOpen: (path: string, newTab: boolean) => void;
      }
    | undefined;
}

/**
 * The bar across a File tab and its tree, or a Changes tab and its own:
 * Back and Forward where the tab keeps a history, the path as breadcrumbs,
 * or plain where nothing is browsed, what stands quietly beside it, then
 * the GitHub button, dimmed with no page to open yet, the ⋯, and the tree's
 * toggle where there is a tree.
 */
export function FileViewBar({
  history,
  path,
  beside,
  onGitHub,
  menu,
  tree,
}: {
  history?: FileHistory | undefined;
  path: BarPath;
  /** What stands quietly after the path: the commit a file is read at, or what became of a changed file. */
  beside?: ReactNode;
  /** Opens the page on GitHub; none dims the button. */
  onGitHub: (() => void) | undefined;
  /** The bar's ⋯. */
  menu: ReactNode;
  /** The tree's toggles, where there is a tree. */
  tree?: PaneToggles | undefined;
}): React.JSX.Element {
  const { browse } = path;
  return (
    <header className="file-view-bar">
      {history === undefined ? null : <HistoryButtons history={history} />}
      {browse === undefined ? (
        <Tooltip label={path.path}>
          <span className="file-view-path">
            <bdi>{path.path}</bdi>
          </span>
        </Tooltip>
      ) : (
        <FileBreadcrumbs
          repository={browse.repository}
          path={path.path}
          listFolder={browse.listFolder}
          onOpen={browse.onOpen}
        />
      )}
      {beside}
      <div className="file-view-actions">
        <Tooltip label="Open on GitHub">
          <button
            type="button"
            className="icon-button"
            aria-label="Open on GitHub"
            disabled={onGitHub === undefined}
            onClick={onGitHub}
          >
            <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />
          </button>
        </Tooltip>
        {menu}
        {tree === undefined ? null : <TreeToggle toggles={tree} />}
      </div>
    </header>
  );
}

/** The file as the tab last told its read, a read of a file or a commit shown before standing for nothing. */
interface TabRead {
  readonly path: string;
  readonly commit: string | undefined;
  readonly read: FileRead;
}

/** What the tab is keyed by while it reads the default branch's head rather than a commit. */
const HEAD_READ = "head";

export function FileView({
  planId,
  repository,
  file,
  snippet,
  shownCode,
  readFile,
  readFolder,
  readWhole,
  openGitHub,
  treeOpen,
  onToggleTree,
  onBrowse,
  history,
  onFoldNote,
  onShowNote,
}: {
  planId: string;
  /** The plan's repository, `owner/name`, which the tree browses; none draws the tab alone. */
  repository: string | null;
  file: OpenFile;
  /** The lines Luke showed of the file, drawn where the file cannot be. */
  snippet: TaskCode | undefined;
  /** Every code Luke showed on the plan, whose files of this repository the tree's filter narrows to. */
  shownCode: readonly TaskCodeShowing[] | undefined;
  readFile: ReadFileWindow;
  /** Lists one folder of the repository through the service. */
  readFolder: ListFolder;
  /** Lists the whole repository in one read through the service, which the tree's search narrows. */
  readWhole: () => Promise<TasksTreeAnswer>;
  openGitHub: (url: string) => void;
  treeOpen: boolean;
  onToggleTree: () => void;
  /** A file chosen in the tree or the breadcrumbs, to show in this tab, or in a tab of its own where `newTab` asks. */
  onBrowse: (path: string, newTab: boolean) => void;
  history: FileHistory;
  /** Folds or opens the note of the call that showed lines of the file, on this tab. */
  onFoldNote: FileNotes["onFold"];
  /** Shows the card the call's code stands on in the Code tab. */
  onShowNote: FileNotes["onShow"];
}): React.JSX.Element {
  // The view's store of listings, one per plan and repository. Note that
  // it lists through a ref to the latest door, so a parent drawing a fresh
  // door neither forgets the listings nor lists the root again.
  const latestRead = useRef(readFolder);
  latestRead.current = readFolder;
  const latestWhole = useRef(readWhole);
  latestWhole.current = readWhole;
  const listFolder = useMemo(
    () => keptListings((path) => latestRead.current(path)),
    [planId, repository],
  );
  // The whole repository is kept beside the folders, read once however many
  // File tabs search it.
  const listWhole = useMemo(() => {
    const kept = keptListings(() => latestWhole.current());
    return () => kept("");
  }, [planId, repository]);

  // Note that the list is kept while the plan shows nothing new, because
  // a fresh one would have the tree draw its filter anew.
  const shown = useMemo(
    () =>
      shownFiles((shownCode ?? []).filter(({ code }) => code.repository === repository)).map(
        (ref) => ref.path,
      ),
    [shownCode, repository],
  );

  const commit = file.commit;
  const notes: FileNotes = {
    notes: notesOf(shownCode, file.path, repository, commit),
    folded: file.foldedNotes ?? [],
    onFold: onFoldNote,
    onShow: onShowNote,
  };

  const [told, setTold] = useState<TabRead | undefined>(undefined);
  const read =
    told?.path === file.path && told.commit === commit ? told.read : { kind: FILE_READ.READING };
  const onRead = useCallback(
    (next: FileRead) => setTold({ path: file.path, commit, read: next }),
    [file.path, commit],
  );
  // Every read of the tab's file asks it at the tab's commit, where one pins it.
  const readAt: ReadFileWindow = (window) =>
    readFile(commit === undefined ? window : { ...window, ref: commit });
  // The whole text, for a copy or a download, read raw through the tab's
  // door in one read, the window it names standing for nothing.
  const readText = (): Promise<WholeText> =>
    readAt({ path: file.path, firstLine: 1, lastLine: 1, raw: true }).then(wholeTextOf, () => ({
      kind: WHOLE_TEXT.UNREAD,
    }));

  // The tree and the breadcrumbs hear each folder in the tree's own words.
  const readFolderListing: ReadFolder = useCallback(
    (path) => listFolder(path).then(listingOf),
    [listFolder],
  );
  const browsing = repository !== null;
  const tree = usePaneRoom({ open: browsing && treeOpen, onToggle: onToggleTree });
  // A file chosen in the tree standing over the tab takes the tree down, to show the file.
  const browse = (path: string, newTab: boolean) => {
    tree.closeOver();
    onBrowse(path, newTab);
  };
  return (
    <div className="file-view" {...tree.root}>
      <FileViewBar
        history={history}
        path={{
          path: file.path,
          browse: browsing
            ? { repository, listFolder: readFolderListing, onOpen: onBrowse }
            : undefined,
        }}
        beside={
          commit === undefined ? null : (
            <Tooltip label={`Read at commit ${commit}`}>
              <span className="file-view-commit">{shortCommit(commit)}</span>
            </Tooltip>
          )
        }
        onGitHub={read.kind === FILE_READ.READY ? () => openGitHub(fileUrl(read, file)) : undefined}
        menu={
          <FileMenu path={file.path} ready={read.kind === FILE_READ.READY} readText={readText} />
        }
        tree={browsing ? tree.toggles : undefined}
      />
      <div className="file-view-body" {...tree.body}>
        {/* Keyed by the file, then by the commit it is read at, so lines read
            at one commit are never laid beside another's. */}
        <Fragment key={file.path}>
          <FileTab
            key={commit ?? HEAD_READ}
            file={file}
            snippet={snippet}
            notes={notes}
            readFile={readAt}
            onRead={onRead}
          />
        </Fragment>
        {browsing && tree.drawn ? (
          <FileTreePane
            file={file.path}
            shown={shown}
            listFolder={readFolderListing}
            readWhole={listWhole}
            onOpen={browse}
            pane={tree.beside.pane}
            leaving={tree.beside.leaving}
          />
        ) : null}
      </div>
    </div>
  );
}
