import type { PlanCode, PlanCodeShowing, PlanningTreeAnswer } from "@sidecar/hosted/planning-view";
import { ArrowLeftIcon, ArrowRightIcon, SidePanelIcon } from "@sidecar/panel";
import { useCallback, useMemo, useRef, useState } from "react";
import { GitHubMark } from "../account-marks";
import type { FileTreeHandle } from "../file-tree/contract";
import { Tooltip } from "../tooltip";
import { shownFiles } from "./code-pane-model";
import { FileBreadcrumbs } from "./file-breadcrumbs";
import { FileMenu } from "./file-menu";
import { FileTab, type ReadFileWindow } from "./file-tab";
import {
  FILE_READ,
  type FileRead,
  fileUrl,
  WHOLE_TEXT,
  type WholeText,
  wholeTextOf,
} from "./file-tab-model";
import { FileTreePane } from "./file-tree-pane";
import { keptListings, type ListFolder } from "./folder-listings";
import { FILE_HISTORY_STEP, type FileHistoryStep, type OpenFile } from "./use-side-panel";

/**
 * file-view.tsx -- a File tab with the plan's repository beside it: one bar across both, the file under it, and the collapsible tree on its right.
 *
 * The bar is the whole view's, the tree's column included, as an editor's
 * is: Back and Forward through the files this tab showed, the file's path
 * as breadcrumbs, then at its end the file opened on GitHub, the ⋯ of what
 * is done with it (`file-menu.tsx`), and the tree's toggle, the side
 * panel's own glyph, since the tree is docked on the right as the panel
 * is. The tab under it reads the file and tells the bar how the read
 * stands, which is what the GitHub button and the menu offer by.
 *
 * The tree and the breadcrumbs both browse the repository the file was
 * read from, listed through one store of what the panel has listed
 * (`folder-listings.ts`). A file chosen in either is shown in this tab, or
 * in a tab of its own where ⌘ was held, by the panel's own rule of one tab
 * per file (`use-side-panel.ts`). A breadcrumb's folder is revealed in the
 * tree, which opens first where it is closed: the reveal waits for the tree
 * to mount. The tree is open or closed for every File tab alike, as the
 * panel holds it, and stands across them, since the tab beside it is keyed
 * by its file and the tree is not. A plan with no repository draws the tab
 * alone, its path plain in the bar.
 */

/** The bar's button that shows or hides the tree, which stands under it at the bar's end. */
function TreeToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const label = open ? "Hide files" : "Show files";
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className="icon-button file-tree-toggle"
        aria-label={label}
        aria-expanded={open}
        data-open={String(open)}
        onClick={onToggle}
      >
        <SidePanelIcon />
      </button>
    </Tooltip>
  );
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

/** The file as the tab last told its read, a read of a file shown before standing for nothing. */
interface TabRead {
  readonly path: string;
  readonly read: FileRead;
}

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
}: {
  planId: string;
  /** The plan's repository, `owner/name`, which the tree browses; none draws the tab alone. */
  repository: string | null;
  file: OpenFile;
  /** The lines Luke showed of the file, drawn where the file cannot be. */
  snippet: PlanCode | undefined;
  /** Every code Luke showed on the plan, whose files of this repository the tree's filter narrows to. */
  shownCode: readonly PlanCodeShowing[] | undefined;
  readFile: ReadFileWindow;
  /** Lists one folder of the repository through the service. */
  readFolder: ListFolder;
  /** Lists the whole repository in one read through the service, which the tree's search narrows. */
  readWhole: () => Promise<PlanningTreeAnswer>;
  openGitHub: (url: string) => void;
  treeOpen: boolean;
  onToggleTree: () => void;
  /** A file chosen in the tree or the breadcrumbs, to show in this tab, or in a tab of its own where `newTab` asks. */
  onBrowse: (path: string, newTab: boolean) => void;
  history: FileHistory;
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

  // The tree as mounted, and a folder a breadcrumb asked for before it was.
  const tree = useRef<FileTreeHandle | undefined>(undefined);
  const pending = useRef<string | undefined>(undefined);
  const onMounted = useCallback((handle: FileTreeHandle | undefined) => {
    tree.current = handle;
    const asked = pending.current;
    if (handle === undefined || asked === undefined) return;
    pending.current = undefined;
    handle.reveal(asked, { folder: true, focus: true });
  }, []);
  const reveal = (folder: string) => {
    if (treeOpen && tree.current !== undefined) {
      tree.current.reveal(folder, { folder: true, focus: true });
      return;
    }
    pending.current = folder;
    if (!treeOpen) onToggleTree();
  };

  const [told, setTold] = useState<TabRead | undefined>(undefined);
  const read = told?.path === file.path ? told.read : { kind: FILE_READ.READING };
  const onRead = useCallback(
    (next: FileRead) => setTold({ path: file.path, read: next }),
    [file.path],
  );
  // The whole text, for a copy or a download, read raw through the tab's
  // door in one read, the window it names standing for nothing.
  const readText = (): Promise<WholeText> =>
    readFile({ path: file.path, firstLine: 1, lastLine: 1, raw: true }).then(wholeTextOf, () => ({
      kind: WHOLE_TEXT.UNREAD,
    }));

  const browsing = repository !== null;
  return (
    <div className="file-view">
      <header className="file-view-bar">
        <HistoryButtons history={history} />
        {browsing ? (
          <FileBreadcrumbs
            repository={repository}
            path={file.path}
            listFolder={listFolder}
            onReveal={reveal}
            onOpen={onBrowse}
          />
        ) : (
          <Tooltip label={file.path}>
            <span className="file-view-path">
              <bdi>{file.path}</bdi>
            </span>
          </Tooltip>
        )}
        <div className="file-view-actions">
          <Tooltip label="Open on GitHub">
            <button
              type="button"
              className="icon-button"
              aria-label="Open on GitHub"
              disabled={read.kind !== FILE_READ.READY}
              onClick={() => {
                if (read.kind === FILE_READ.READY) openGitHub(fileUrl(read, file));
              }}
            >
              <GitHubMark />
            </button>
          </Tooltip>
          <FileMenu path={file.path} ready={read.kind === FILE_READ.READY} readText={readText} />
          {browsing ? <TreeToggle open={treeOpen} onToggle={onToggleTree} /> : null}
        </div>
      </header>
      <div className="file-view-body">
        <FileTab
          key={file.path}
          file={file}
          snippet={snippet}
          readFile={readFile}
          onRead={onRead}
        />
        {browsing && treeOpen ? (
          <FileTreePane
            file={file.path}
            shown={shown}
            listFolder={listFolder}
            readWhole={listWhole}
            onOpen={onBrowse}
            onMounted={onMounted}
          />
        ) : null}
      </div>
    </div>
  );
}
