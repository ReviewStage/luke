import type { PlanCode, PlanCodeShowing } from "@sidecar/hosted/planning-view";
import { PanelRightIcon } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import type { FileTreeHandle } from "../file-tree/contract";
import { Tooltip } from "../tooltip";
import { shownFiles } from "./code-pane-model";
import { FileBreadcrumbs } from "./file-breadcrumbs";
import { FileTab, type ReadFileWindow } from "./file-tab";
import { FileTreePane } from "./file-tree-pane";
import { keptListings, type ListFolder } from "./folder-listings";
import type { OpenFile } from "./use-side-panel";

/**
 * file-view.tsx -- a File tab with the plan's repository beside it: the file across the panel, its path as breadcrumbs, and the collapsible tree on its right.
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
 * alone.
 */

/** The heading's button that shows or hides the tree. */
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
        className="icon-button code-card-action file-tree-toggle"
        aria-label={label}
        aria-pressed={open}
        onClick={onToggle}
      >
        <PanelRightIcon aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

export function FileView({
  planId,
  repository,
  file,
  snippet,
  shownCode,
  readFile,
  readFolder,
  openGitHub,
  treeOpen,
  onToggleTree,
  onBrowse,
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
  openGitHub: (url: string) => void;
  treeOpen: boolean;
  onToggleTree: () => void;
  /** A file chosen in the tree or the breadcrumbs, to show in this tab, or in a tab of its own where `newTab` asks. */
  onBrowse: (path: string, newTab: boolean) => void;
}): React.JSX.Element {
  // The view's store of listings, one per plan and repository. Note that
  // it lists through a ref to the latest door, so a parent drawing a fresh
  // door neither forgets the listings nor lists the root again.
  const latestRead = useRef(readFolder);
  latestRead.current = readFolder;
  const listFolder = useMemo(
    () => keptListings((path) => latestRead.current(path)),
    [planId, repository],
  );

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

  const browsing = repository !== null;
  return (
    <div className="file-view">
      <FileTab
        key={file.path}
        file={file}
        snippet={snippet}
        readFile={readFile}
        openGitHub={openGitHub}
        crumbs={
          browsing ? (
            <FileBreadcrumbs
              repository={repository}
              path={file.path}
              listFolder={listFolder}
              onReveal={reveal}
              onOpen={(path) => onBrowse(path, false)}
            />
          ) : undefined
        }
        actions={browsing ? <TreeToggle open={treeOpen} onToggle={onToggleTree} /> : undefined}
      />
      {browsing && treeOpen ? (
        <FileTreePane
          file={file.path}
          shown={shown}
          listFolder={listFolder}
          onOpen={onBrowse}
          onMounted={onMounted}
        />
      ) : null}
    </div>
  );
}
