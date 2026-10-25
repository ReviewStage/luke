import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { TasksTreeAnswer } from "@luke/features/tasks-view";
import { noMatchWords, readingWords, TERM } from "@luke/features/words";
import {
  cssCustomProperties,
  FailureNote,
  Fill,
  IconButton,
  NOTE_LINE_LOOK,
  NoteLine,
  OVER_PANE_WIDTH,
  OverPane,
  PanePin,
  ResizeEdge,
  type ResizeEdgeHandle,
  SearchField,
  SpinnerRegion,
  Tooltip,
} from "@luke/ui";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { ListFilterIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TREE_LOAD_FAILED, useSideBundles } from "../bundle-loader.js";
import {
  type FileMark,
  type FileTreeHandle,
  type FileTreeModule,
  type FolderEntry,
  type ReadFolder,
  TREE_STANDING,
  type TreeStanding,
} from "../file-tree/contract.js";
import type { PaneOver } from "./file-view.js";
import { entriesOf } from "./folder-listings.js";

/**
 * file-tree-pane.tsx -- the tree beside a File tab: the task's repository a folder at a time, drawn by the file tree bundle, the tab's file marked in it.
 *
 * The tree is drawn by the file tree bundle (`../file-tree/`), loaded the
 * first time a tree is shown and kept for the window's life
 * (`../bundle-loader.ts`). The pane hands it the folders as the panel lists
 * them (`folder-listings.ts`), a refusal put in the File tab's own words,
 * and reveals the tab's file in it whenever the tab shows another, its
 * folders opened and it marked, as an editor's explorer follows the file
 * shown. Over the tree stand a search field, which narrows the rows to the
 * paths holding what is typed, over the whole repository listed in one read
 * the first time the field is used, or over the folders listed so far where
 * that read did not land or was cut short, as the empty field then says; and a filter, which shows only the files
 * Luke showed on the task; ⌘F anywhere in the pane takes the caret to the
 * field. The tree draws rows alone, so where it stands is said here, in its
 * place or under it (`FileTreeStage`), which a crumb's tree says the same
 * way. Every name here is the repository's, so the pane is left out of the
 * screen recording (`ph-no-capture`).
 *
 * Beside its tab the pane is a box of its own, which slides as the panel
 * opens and closes it; where its tab has no room for it beside, it is an
 * `OverPane` (`over`), floated over the tab's right edge as a sheet, or a
 * column where it is only peeked out of its strip, and slid out again as it
 * is put away.
 *
 * An agent's Changes tab stands the same pane beside its diff
 * (`agent-changes-tab.tsx`), over its pull request's files alone: the tree
 * shows only them, every folder open, each row marked with what became of
 * its file, the search narrowing those rows, held by the tab, which narrows
 * its list of diffs by the same words, and no filter beside it.
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

/** What a tree says in its place while its files are read or a search matches none, and under its rows once a folder was cut short. */
const TREE_WORDS = {
  READING: readingWords(TERM.FILE.many),
  NO_MATCH: noMatchWords(TERM.FILE),
  CUT_SHORT: "Some folders hold more than the tree lists. Open them on GitHub to see the rest.",
} as const;

/** Where a tree stands before its bundle has told it anything: its root being read. */
export const TREE_READING: TreeStanding = { kind: TREE_STANDING.READING };

/**
 * The host a tree is mounted in, with where it stands said around it: its
 * bundle or its root being read, why either could not be, with Retry where
 * listing again may help, or that a search matches nothing, each in the
 * tree's place; and once a folder was listed short of whole, that line under
 * its rows. Note that the host stays mounted, hidden while the words stand
 * in its place, because the tree drawn in it outlives every standing.
 */
export function FileTreeStage({
  module,
  missed,
  host,
  standing,
  onRetry,
  onRetryBundle,
}: {
  /** The tree's bundle once it landed; none while it loads or where it could not. */
  module: FileTreeModule | undefined;
  /** Whether the bundle could not be loaded. */
  missed: boolean;
  host: React.Ref<HTMLElement>;
  standing: TreeStanding;
  /** Lists the root again, where it could not be listed. */
  onRetry: () => void;
  /** Imports the bundle again, where it could not be loaded. */
  onRetryBundle: () => void;
}): React.JSX.Element {
  if (module === undefined) {
    return missed ? (
      <FailureNote onRetry={onRetryBundle}>{TREE_LOAD_FAILED}</FailureNote>
    ) : (
      <SpinnerRegion delay label={TREE_WORDS.READING} />
    );
  }
  const drawn = standing.kind === TREE_STANDING.DRAWN;
  return (
    <>
      {standing.kind === TREE_STANDING.READING ? (
        <SpinnerRegion delay label={TREE_WORDS.READING} />
      ) : null}
      {standing.kind === TREE_STANDING.FAILED ? (
        <FailureNote onRetry={standing.retry ? onRetry : undefined}>{standing.notice}</FailureNote>
      ) : null}
      {standing.kind === TREE_STANDING.NO_MATCH ? (
        <NoteLine look={NOTE_LINE_LOOK.LIST}>{TREE_WORDS.NO_MATCH}</NoteLine>
      ) : null}
      <Fill className="file-tree-host" ref={host} hidden={!drawn} />
      {"cut" in standing && standing.cut ? (
        <NoteLine look={NOTE_LINE_LOOK.LIST}>{TREE_WORDS.CUT_SHORT}</NoteLine>
      ) : null}
    </>
  );
}

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

/** What the tree is handed, the same whether its pane stands beside the tab or over it. */
interface FileTreeBodyProps {
  /** The File tab's file, revealed in the tree. */
  file: string;
  /** The files of the repository Luke showed on the task, which the filter narrows the tree to; none draws no filter. */
  shown?: readonly string[] | undefined;
  /** The only files the tree shows, every folder open, in the filter's place: a change set's. */
  only?: readonly string[] | undefined;
  /** What became of each file of a change set, lettered on its row, with whatever else its mark carries drawn at the row's end. */
  marks?: readonly FileMark[] | undefined;
  /** What the search holds and the door that sets it, where its holder narrows more than the tree by it; none keeps it in the pane. */
  search?: { readonly query: string; readonly onQuery: (query: string) => void } | undefined;
  listFolder: ReadFolder;
  /** Lists the whole repository in one read, everything under its root, which the search narrows; none narrows the rows as they stand. */
  readWhole?: (() => Promise<TasksTreeAnswer>) | undefined;
  /** A file chosen in the tree, to open in the tab, or in a tab of its own where ⌘ was held. */
  onOpen: (path: string, newTab: boolean) => void;
  /** A file's Viewed toggle pressed on its row, drawn where its mark says whether it is viewed. */
  onViewed?: ((path: string) => void) | undefined;
}

/** The tree itself, its search over it: what stands in the pane's box wherever the pane stands. */
function FileTreeBody({
  file,
  shown,
  only,
  marks,
  search,
  listFolder,
  readWhole,
  onOpen,
  onViewed,
  field,
  floating,
}: FileTreeBodyProps & {
  /** The search field's box, which takes the keyboard in a pane opened over the tab. */
  field: React.RefObject<HTMLInputElement | null>;
  /** Whether the pane floats over its tab, which Escape puts away. */
  floating: boolean;
}): React.JSX.Element {
  const { fileTree } = useSideBundles();
  const loaded = useAtomValue(fileTree);
  const retryBundle = useAtomRefresh(fileTree);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<FileTreeHandle | undefined>(undefined);
  const revealed = useRef<string | undefined>(undefined);
  const [ownQuery, setOwnQuery] = useState("");
  const query = search?.query ?? ownQuery;
  const setQuery = search?.onQuery ?? setOwnQuery;
  const [onlyShown, setOnlyShown] = useState(false);
  const [scope, setScope] = useState<SearchScope>(SEARCH_SCOPE.UNREAD);
  const [standing, setStanding] = useState<TreeStanding>(TREE_READING);
  const everything = useRef<readonly FolderEntry[] | undefined>(undefined);
  const narrowed =
    only ?? (onlyShown && shown !== undefined && shown.length > 0 ? shown : undefined);
  // Note that the tree is handed doors that read the latest props, so it is
  // mounted once however often the pane is drawn.
  const latest = useRef({ listFolder, onOpen, onViewed, file, query, narrowed, marks });
  latest.current = { listFolder, onOpen, onViewed, file, query, narrowed, marks };

  useEffect(() => {
    const element = host.current;
    if (module === undefined || element === null) return undefined;
    const mounted = module.mount(element, {
      readFolder: (path) => latest.current.listFolder(path),
      onStanding: setStanding,
      onOpen: (path, newTab) => latest.current.onOpen(path, newTab),
      onViewed: (path) => latest.current.onViewed?.(path),
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
    <Fill
      className="ph-no-capture"
      onKeyDown={(event) => {
        if (event.key.toLowerCase() !== "f" || !(event.metaKey || event.ctrlKey)) return;
        // Note that the press goes no further, because the window's ⌘F would
        // open the tab's find bar over the field it just put the caret in.
        event.preventDefault();
        event.stopPropagation();
        field.current?.focus();
        field.current?.select();
      }}
    >
      <search className="file-tree-search flex items-center gap-control-gap border-b border-border px-item-gap py-tight-gap">
        <Fill>
          <TreeSearch
            field={field}
            query={query}
            scope={scope}
            floating={floating}
            onQuery={setQuery}
          />
        </Fill>
        {shown === undefined ? null : (
          <Tooltip label={shown.length === 0 ? "Luke has shown no files yet" : filterLabel}>
            <IconButton
              icon={<ListFilterIcon aria-hidden="true" />}
              label="Only files Luke showed"
              pressed={onlyShown}
              disabled={shown.length === 0}
              focusableWhenDisabled
              onClick={() => setOnlyShown((on) => !on)}
            />
          </Tooltip>
        )}
      </search>
      <FileTreeStage
        module={module}
        missed={AsyncResult.isFailure(loaded)}
        host={host}
        standing={standing}
        onRetry={() => handle.current?.relist()}
        onRetryBundle={retryBundle}
      />
    </Fill>
  );
}

export function FileTreePane({
  label = "Files",
  over,
  narrow = false,
  pane,
  leaving = false,
  width,
  edge,
  ...tree
}: FileTreeBodyProps & {
  /** What the pane is called. */
  label?: string;
  /** What the pane floating over its tab is handed (`file-view.tsx`); none draws it beside the tab. */
  over?: PaneOver | undefined;
  /** Whether the tab has no room for the pane beside it, which floats it as a sheet rather than a column. */
  narrow?: boolean;
  /** The pane's own box beside the tab, which its slide in and out plays on (`file-view.tsx`). */
  pane?: React.Ref<HTMLElement> | undefined;
  /** Whether it is on its way out beside the tab: drawn over the file's edge rather than beside it, and out of reach. */
  leaving?: boolean;
  /** How wide it stands beside the tab, as the panel keeps it for every tree; none stands at its default width. */
  width?: number | undefined;
  /** The edge on its left it is dragged wider or narrower by; none draws none. */
  edge?: ResizeEdgeHandle | undefined;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null);
  if (over !== undefined) {
    return (
      <OverPane
        open={over.open}
        peek={over.peek}
        onClose={over.onClose}
        onPointerLeave={over.onPointerLeave}
        toggle={over.toggle}
        initialFocus={field}
        label={label}
        width={narrow ? OVER_PANE_WIDTH.SHEET : OVER_PANE_WIDTH.COLUMN}
      >
        <FileTreeBody {...tree} field={field} floating />
      </OverPane>
    );
  }
  return (
    <PanePin
      ref={pane}
      className="file-tree-pane relative flex w-file-tree min-w-0 flex-none flex-col border-l border-border data-leaving:absolute data-leaving:inset-y-0 data-leaving:right-0 data-leaving:bg-well"
      aria-label={label}
      data-leaving={leaving ? "" : undefined}
      inert={leaving}
      style={
        width === undefined ? undefined : cssCustomProperties({ "--file-tree-width": `${width}px` })
      }
      onPin={undefined}
    >
      {edge === undefined ? null : <ResizeEdge edge={edge} />}
      <FileTreeBody {...tree} field={field} floating={false} />
    </PanePin>
  );
}
