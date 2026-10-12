import { useAtomValue } from "@effect/atom-react";
import { PLAN_TREE_ENTRY } from "@sidecar/hosted/plan-wire";
import type { PlanningTreeAnswer } from "@sidecar/hosted/planning-view";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useEffect, useRef } from "react";
import { bundleAtom } from "../bundle-loader";
import { FILE_TREE_ASSET, type FileTreeHandle, type FolderListing } from "../file-tree/contract";
import { refusalLine, refusalPasses } from "./file-tab-model";
import type { ListFolder } from "./folder-listings";

/**
 * file-tree-pane.tsx -- the tree beside a File tab: the plan's repository a folder at a time, drawn by the file tree bundle, the tab's file marked in it.
 *
 * The tree is drawn by the file tree bundle (`../file-tree/`), loaded the
 * first time a tree is shown and kept for the window's life
 * (`../bundle-loader.ts`). The pane hands it the folders as the panel lists
 * them (`folder-listings.ts`), a refusal put in the File tab's own words,
 * and reveals the tab's file in it whenever the tab shows another, its
 * folders opened and it marked, as an editor's explorer follows the file
 * shown. Every name here is the repository's, so the pane is left out of
 * the screen recording (`ph-no-capture`).
 */

/** Where the tree stands while its bundle loads or fails to. */
const TREE_LOAD_FAILED = "The files could not be shown.";

const fileTreeModuleAtom = bundleAtom(
  { script: FILE_TREE_ASSET.SCRIPT },
  () => window.lukeFileTree,
  TREE_LOAD_FAILED,
);

/** A folder's listing as the tree hears it: its entries, or why it is not listed and whether listing again may help. */
function listingOf(answer: PlanningTreeAnswer): FolderListing {
  if ("folder" in answer) {
    return {
      entries: answer.folder.entries.map((entry) => ({
        name: entry.name,
        folder: entry.kind === PLAN_TREE_ENTRY.FOLDER,
      })),
    };
  }
  if ("failure" in answer) return { notice: "The files could not be read.", retry: true };
  return {
    notice: refusalLine(answer.refusal, answer.branch),
    retry: refusalPasses(answer.refusal),
  };
}

export function FileTreePane({
  repository,
  file,
  listFolder,
  onOpen,
  onMounted,
}: {
  /** The plan's repository, `owner/name`, which the heading names. */
  repository: string;
  /** The File tab's file, revealed in the tree. */
  file: string;
  listFolder: ListFolder;
  /** A file chosen in the tree, to open in the tab, or in a tab of its own where ⌘ was held. */
  onOpen: (path: string, newTab: boolean) => void;
  /** The tree mounted, or taken down: the handle a breadcrumb reveals a folder through. */
  onMounted: (handle: FileTreeHandle | undefined) => void;
}): React.JSX.Element {
  const loaded = useAtomValue(fileTreeModuleAtom);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<FileTreeHandle | undefined>(undefined);
  const revealed = useRef<string | undefined>(undefined);
  // Note that the tree is handed doors that read the latest props, so it is
  // mounted once however often the pane is drawn.
  const latest = useRef({ listFolder, onOpen, onMounted, file });
  latest.current = { listFolder, onOpen, onMounted, file };

  useEffect(() => {
    const element = host.current;
    if (module === undefined || element === null) return undefined;
    const mounted = module.mount(element, {
      readFolder: (path) => latest.current.listFolder(path).then(listingOf),
      onOpen: (path, newTab) => latest.current.onOpen(path, newTab),
    });
    handle.current = mounted;
    // Note that the file is revealed before a breadcrumb's folder waiting
    // on the mount, because a later reveal stands in for one still listing.
    revealed.current = latest.current.file;
    mounted.reveal(latest.current.file, { folder: false, focus: false });
    latest.current.onMounted(mounted);
    return () => {
      latest.current.onMounted(undefined);
      handle.current = undefined;
      mounted.unmount();
    };
  }, [module]);

  useEffect(() => {
    if (handle.current === undefined || revealed.current === file) return;
    revealed.current = file;
    handle.current.reveal(file, { folder: false, focus: false });
  }, [file]);

  return (
    <aside className="file-tree-pane ph-no-capture" aria-label="Files">
      <header className="file-tree-header">
        <span className="file-tree-title">{repository}</span>
      </header>
      {module === undefined ? (
        <p className="file-tree-notice">
          {AsyncResult.isFailure(loaded) ? TREE_LOAD_FAILED : "Reading the files…"}
        </p>
      ) : (
        <div className="file-tree-host" ref={host} />
      )}
    </aside>
  );
}
