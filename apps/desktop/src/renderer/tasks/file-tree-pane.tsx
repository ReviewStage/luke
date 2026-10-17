import { useAtomValue } from "@effect/atom-react";
import type { TasksTreeAnswer } from "@luke/features/tasks-view";
import { IconButton, SearchField } from "@luke/ui";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { ListFilterIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { FloatingBox } from "../desktop/hover-pane";
import type { FileMark, FileTreeHandle, FolderEntry, ReadFolder } from "../file-tree/contract";
import { Tooltip } from "../tooltip";
import { fileTreeModuleAtom, TREE_LOAD_FAILED } from "./file-tree-bundle";
import { entriesOf } from "./folder-listings";

/**
 * file-tree-pane.tsx -- the tree beside a File tab: the task's repository a folder at a time, drawn by the file tree bundle, the tab's file marked in it.
 *
 * The tree is drawn by the file tree bundle (`../file-tree/`), loaded the
 * first time a tree is shown and kept for the window's life
 * (`file-tree-bundle.ts`). The pane hands it the folders as the panel lists
 * them (`folder-listings.ts`), a refusal put in the File tab's own words,
 * and reveals the tab's file in it whenever the tab shows another, its
 * folders opened and it marked, as an editor's explorer follows the file
 * shown. Over the tree stand a search field, which narrows the rows to the
 * paths holding what is typed, over the whole repository listed in one read
 * the first time the field is used, or over the folders listed so far where
 * that read did not land or was cut short, as the empty field then says; and a filter, which shows only the files
 * Luke showed on the task; ⌘F anywhere in the pane takes the caret to the
 * field. Every name here is the repository's, so the pane is left out of the
 * screen recording (`ph-no-capture`).
 *
 * An agent's Changes tab stands the same pane beside its diff
 * (`agent-changes-tab.tsx`), over its pull request's files alone: the tree
 * shows only them, every folder open, each row marked with what became of
 * its file, the search narrowing those rows, no filter beside it, and a
 * line under the tree counting them.
 */

/**
 * What the search covers: not yet asked, the whole repository being read or
 * read, or only the folders listed so far, the whole having been cut short,
 * or its read not having landed for the search standing.
 */
const SEARCH_SCOPE = {
  UNREAD: "unread",
  READING: "reading",
  WHOLE: "whole",
  OPENED: "opened",
  MISSED: "missed",
} as const;

type SearchScope = (typeof SEARCH_SCOPE)[keyof typeof SEARCH_SCOPE];

/** The pane's search field over the tree: Escape clears what is typed, then lets go of the caret, or, in a tree floating over its tab, puts the tree away. */
function TreeSearch({
  field,
  query,
  scope,
  floating,
  onQuery,
}: {
  field: React.RefObject<HTMLInputElement | null>;
  query: string;
  scope: SearchScope;
  floating: boolean;
  onQuery: (query: string) => void;
}): React.JSX.Element {
  // Note that a floating tree hears an Escape with nothing typed, to put
  // itself away, so the field answers none then; any other Escape is the
  // field's, kept from the window's own, which would close the panel.
  const answerEscape =
    query.length === 0 && floating
      ? undefined
      : () => (query.length > 0 ? onQuery("") : field.current?.blur());
  return (
    <SearchField
      ref={field}
      label="Search files"
      placeholder={scope === SEARCH_SCOPE.OPENED ? "Search opened folders" : "Search files"}
      value={query}
      onChange={onQuery}
      onClear={() => onQuery("")}
      onEscape={answerEscape}
    />
  );
}

export function FileTreePane({
  file,
  shown,
  only,
  marks,
  label = "Files",
  foot,
  listFolder,
  readWhole,
  onOpen,
  pane,
  float,
  leaving = false,
}: {
  /** The File tab's file, revealed in the tree. */
  file: string;
  /** The files of the repository Luke showed on the task, which the filter narrows the tree to; none draws no filter. */
  shown?: readonly string[] | undefined;
  /** The only files the tree shows, every folder open, in the filter's place: a change set's. */
  only?: readonly string[] | undefined;
  /** What became of each file of a change set, lettered on its row. */
  marks?: readonly FileMark[] | undefined;
  /** What the pane is called. */
  label?: string;
  /** What stands under the tree, such as a change set's count. */
  foot?: ReactNode;
  listFolder: ReadFolder;
  /** Lists the whole repository in one read, everything under its root, which the search narrows; none narrows the rows as they stand. */
  readWhole?: (() => Promise<TasksTreeAnswer>) | undefined;
  /** A file chosen in the tree, to open in the tab, or in a tab of its own where ⌘ was held. */
  onOpen: (path: string, newTab: boolean) => void;
  /** The pane's own box, which its slide in and out plays on (`file-view.tsx`). */
  pane?: React.Ref<HTMLElement> | undefined;
  /** What the pane answers while it may float over its tab (`hover-pane.ts`). */
  float?: FloatingBox | undefined;
  /** Whether it is on its way out: drawn over the file's edge rather than beside it, and out of reach. */
  leaving?: boolean;
}): React.JSX.Element {
  const loaded = useAtomValue(fileTreeModuleAtom);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<FileTreeHandle | undefined>(undefined);
  const revealed = useRef<string | undefined>(undefined);
  const field = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [onlyShown, setOnlyShown] = useState(false);
  const [scope, setScope] = useState<SearchScope>(SEARCH_SCOPE.UNREAD);
  const everything = useRef<readonly FolderEntry[] | undefined>(undefined);
  const narrowed =
    only ?? (onlyShown && shown !== undefined && shown.length > 0 ? shown : undefined);
  // Note that the tree is handed doors that read the latest props, so it is
  // mounted once however often the pane is drawn.
  const latest = useRef({ listFolder, onOpen, file, query, narrowed, marks });
  latest.current = { listFolder, onOpen, file, query, narrowed, marks };

  useEffect(() => {
    const element = host.current;
    if (module === undefined || element === null) return undefined;
    const mounted = module.mount(element, {
      readFolder: (path) => latest.current.listFolder(path),
      onOpen: (path, newTab) => latest.current.onOpen(path, newTab),
    });
    handle.current = mounted;
    if (everything.current !== undefined) mounted.within(everything.current);
    mounted.search(latest.current.query);
    mounted.only(latest.current.narrowed);
    mounted.mark(latest.current.marks ?? []);
    revealed.current = latest.current.file;
    mounted.reveal(latest.current.file, { focus: false });
    return () => {
      handle.current = undefined;
      mounted.unmount();
    };
  }, [module]);

  useEffect(() => {
    if (handle.current === undefined || revealed.current === file) return;
    revealed.current = file;
    handle.current.reveal(file, { focus: false });
  }, [file]);

  // Note that the whole repository is read the first time a search is
  // typed rather than as the tree opens, because most trees are browsed and
  // never searched. A read that did not land leaves the search on the
  // folders listed until the field is emptied, so the next search asks
  // again and this one asks no more; one cut short leaves it there for good.
  useEffect(() => {
    if (query.trim() === "") {
      if (scope === SEARCH_SCOPE.MISSED) setScope(SEARCH_SCOPE.UNREAD);
      return;
    }
    if (scope !== SEARCH_SCOPE.UNREAD || readWhole === undefined) return;
    setScope(SEARCH_SCOPE.READING);
    readWhole().then(
      (answer) => {
        if (!("folder" in answer)) return setScope(SEARCH_SCOPE.MISSED);
        if (answer.folder.truncated) return setScope(SEARCH_SCOPE.OPENED);
        everything.current = entriesOf(answer.folder.entries);
        handle.current?.within(everything.current);
        setScope(SEARCH_SCOPE.WHOLE);
      },
      () => setScope(SEARCH_SCOPE.MISSED),
    );
  }, [query, scope, readWhole]);

  useEffect(() => {
    handle.current?.search(query);
  }, [query]);
  useEffect(() => {
    handle.current?.only(narrowed);
  }, [narrowed]);
  useEffect(() => {
    handle.current?.mark(marks ?? []);
  }, [marks]);

  const filterLabel = onlyShown ? "Show all files" : "Show only files Luke showed";
  return (
    <aside
      ref={pane}
      className="file-tree-pane ph-no-capture"
      aria-label={label}
      data-leaving={leaving ? "" : undefined}
      inert={leaving}
      onPointerDown={float?.onPointerDown}
      onPointerLeave={float?.onPointerLeave}
      onKeyDown={(event) => {
        float?.onKeyDown(event);
        if (event.key.toLowerCase() !== "f" || !(event.metaKey || event.ctrlKey)) return;
        // Note that the press goes no further, because the window's ⌘F would
        // open the tab's find bar over the field it just put the caret in.
        event.preventDefault();
        event.stopPropagation();
        field.current?.focus();
        field.current?.select();
      }}
    >
      <search className="file-tree-search">
        <TreeSearch
          field={field}
          query={query}
          scope={scope}
          floating={float?.floating ?? false}
          onQuery={setQuery}
        />
        {shown === undefined ? null : (
          <Tooltip label={shown.length === 0 ? "Luke has shown no files yet" : filterLabel}>
            <IconButton
              icon={<ListFilterIcon aria-hidden="true" />}
              label="Only files Luke showed"
              pressed={onlyShown}
              disabled={shown.length === 0}
              onClick={() => setOnlyShown((on) => !on)}
            />
          </Tooltip>
        )}
      </search>
      {module === undefined ? (
        <p className="file-tree-notice">
          {AsyncResult.isFailure(loaded) ? TREE_LOAD_FAILED : "Reading the files…"}
        </p>
      ) : (
        <div className="file-tree-host" ref={host} />
      )}
      {foot === undefined ? null : <p className="file-tree-foot">{foot}</p>}
    </aside>
  );
}
