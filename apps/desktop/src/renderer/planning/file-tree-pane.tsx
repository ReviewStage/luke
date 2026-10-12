import { useAtomValue } from "@effect/atom-react";
import { PLAN_TREE_ENTRY } from "@sidecar/hosted/plan-wire";
import type { PlanningTreeAnswer } from "@sidecar/hosted/planning-view";
import { CloseIcon, SearchIcon } from "@sidecar/panel";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { ListFilterIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { bundleAtom } from "../bundle-loader";
import { FILE_TREE_ASSET, type FileTreeHandle, type FolderListing } from "../file-tree/contract";
import { Tooltip } from "../tooltip";
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
 * shown. Over the tree stand a search field, which narrows the rows to the
 * paths holding what is typed, and a filter, which shows only the files
 * Luke showed on the plan; ⌘F anywhere in the pane takes the caret to the
 * field. A breadcrumb's folder lets go of both, since it asks to see the
 * folder whatever was narrowed. Every name here is the repository's, so the
 * pane is left out of the screen recording (`ph-no-capture`).
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
      truncated: answer.folder.truncated,
    };
  }
  if ("failure" in answer) return { notice: "The files could not be read.", retry: true };
  return {
    notice: refusalLine(answer.refusal, answer.branch),
    retry: refusalPasses(answer.refusal),
  };
}

/** The pane's search field over the tree: Escape clears what is typed, then lets go of the caret. */
function TreeSearch({
  field,
  query,
  onQuery,
}: {
  field: React.RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (query: string) => void;
}): React.JSX.Element {
  return (
    <label className="settings-search-well file-tree-search-well">
      <SearchIcon />
      <input
        ref={field}
        className="settings-search-input"
        aria-label="Search files"
        placeholder="Search files"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          // Note that an Escape is stopped here, because the window's own
          // Escape would close the panel behind the field.
          if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
          event.stopPropagation();
          if (query.length > 0) onQuery("");
          else field.current?.blur();
        }}
      />
      {query.length > 0 ? (
        <button
          type="button"
          className="icon-button settings-search-clear"
          aria-label="Clear search"
          onClick={() => {
            onQuery("");
            field.current?.focus();
          }}
        >
          <CloseIcon />
        </button>
      ) : null}
    </label>
  );
}

export function FileTreePane({
  file,
  shown,
  listFolder,
  onOpen,
  onMounted,
}: {
  /** The File tab's file, revealed in the tree. */
  file: string;
  /** The files of the repository Luke showed on the plan, which the filter narrows the tree to. */
  shown: readonly string[];
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
  const field = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [onlyShown, setOnlyShown] = useState(false);
  const narrowed = onlyShown && shown.length > 0 ? shown : undefined;
  // Note that the tree is handed doors that read the latest props, so it is
  // mounted once however often the pane is drawn.
  const latest = useRef({ listFolder, onOpen, onMounted, file, query, narrowed });
  latest.current = { listFolder, onOpen, onMounted, file, query, narrowed };

  useEffect(() => {
    const element = host.current;
    if (module === undefined || element === null) return undefined;
    const mounted = module.mount(element, {
      readFolder: (path) => latest.current.listFolder(path).then(listingOf),
      onOpen: (path, newTab) => latest.current.onOpen(path, newTab),
    });
    handle.current = mounted;
    mounted.search(latest.current.query);
    mounted.only(latest.current.narrowed);
    // Note that the file is revealed before a breadcrumb's folder waiting
    // on the mount, because a later reveal stands in for one still listing.
    revealed.current = latest.current.file;
    mounted.reveal(latest.current.file, { folder: false, focus: false });
    latest.current.onMounted({
      ...mounted,
      reveal: (path, options) => {
        if (options.folder) {
          mounted.search("");
          mounted.only(undefined);
          setQuery("");
          setOnlyShown(false);
        }
        mounted.reveal(path, options);
      },
    });
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

  useEffect(() => {
    handle.current?.search(query);
  }, [query]);
  useEffect(() => {
    handle.current?.only(narrowed);
  }, [narrowed]);

  const filterLabel = onlyShown ? "Show all files" : "Show only files Luke showed";
  return (
    <aside
      className="file-tree-pane ph-no-capture"
      aria-label="Files"
      onKeyDown={(event) => {
        if (event.key.toLowerCase() !== "f" || !(event.metaKey || event.ctrlKey)) return;
        event.preventDefault();
        field.current?.focus();
        field.current?.select();
      }}
    >
      <search className="file-tree-search">
        <TreeSearch field={field} query={query} onQuery={setQuery} />
        <Tooltip label={shown.length === 0 ? "Luke has shown no files yet" : filterLabel}>
          <button
            type="button"
            className="icon-button file-tree-filter"
            aria-label="Only files Luke showed"
            aria-pressed={onlyShown}
            disabled={shown.length === 0}
            onClick={() => setOnlyShown((on) => !on)}
          >
            <ListFilterIcon aria-hidden="true" />
          </button>
        </Tooltip>
      </search>
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
