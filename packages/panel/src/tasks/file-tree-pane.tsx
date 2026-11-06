import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { TasksTreeAnswer } from "@repo/features/tasks-view";
import { noMatchWords, readingWords, TERM } from "@repo/features/words";
import {
  cssCustomProperties,
  FAILURE_NOTE_LOOK,
  FailureNote,
  Fill,
  NOTE_LINE_LOOK,
  NoteLine,
  OVER_PANE_WIDTH,
  OverPane,
  PanePin,
  ResizeEdge,
  type ResizeEdgeHandle,
  SearchField,
  SpinnerRegion,
} from "@repo/ui";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useRef, useState } from "react";
import { TREE_LOAD_FAILED, useSideBundles } from "../bundle-loader.js";
import { unreadShown } from "../failure-report.js";
import {
  type FileMark,
  type FileTreeHandle,
  type FileTreeModule,
  type FolderEntry,
  type ReadFolder,
  TREE_STANDING,
  type TreeStanding,
} from "../file-tree/contract.js";
import { usePhoneRoom } from "../stage-room.js";
import { useRegained } from "../use-regained.js";
import type { PaneOver } from "./file-view.js";
import { entriesOf } from "./folder-listings.js";

const SEARCH_SCOPE = {
  UNREAD: "unread",
  READING: "reading",
  WHOLE: "whole",
  OPENED: "opened",
  MISSED: "missed",
} as const;

type SearchScope = (typeof SEARCH_SCOPE)[keyof typeof SEARCH_SCOPE];

const TREE_WORDS = {
  READING: readingWords(TERM.FILE.many),
  NO_MATCH: noMatchWords(TERM.FILE),
  CUT_SHORT: "Some folders hold more than the tree lists. Open them on GitHub to see the rest.",
} as const;

export const TREE_READING: TreeStanding = { kind: TREE_STANDING.READING };

export function FileTreeStage({
  module,
  missed,
  host,
  standing,
  onRetry,
  onRetryBundle,
}: {
  module: FileTreeModule | undefined;
  missed: boolean;
  host: React.Ref<HTMLElement>;
  standing: TreeStanding;
  onRetry: () => void;
  onRetryBundle: () => void;
}): React.JSX.Element {
  if (module === undefined) {
    return missed ? (
      <FailureNote
        failure={unreadShown(FAILURE_SURFACE.BUNDLE_LOAD)}
        look={FAILURE_NOTE_LOOK.LIST}
        onRetry={onRetryBundle}
      >
        {TREE_LOAD_FAILED}
      </FailureNote>
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
        <FailureNote
          failure={unreadShown(FAILURE_SURFACE.FILE_TREE_READ)}
          look={FAILURE_NOTE_LOOK.LIST}
          onRetry={standing.retry ? onRetry : undefined}
        >
          {standing.notice}
        </FailureNote>
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

interface FileTreeBodyProps {
  file: string;
  only?: readonly string[] | undefined;
  marks?: readonly FileMark[] | undefined;
  search?: { readonly query: string; readonly onQuery: (query: string) => void } | undefined;
  listFolder: ReadFolder;
  readWhole?: (() => Promise<TasksTreeAnswer>) | undefined;
  onOpen: (path: string, newTab: boolean) => void;
  onViewed?: ((path: string) => void) | undefined;
}

function FileTreeBody({
  file,
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
  field: React.RefObject<HTMLInputElement | null>;
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
  const [scope, setScope] = useState<SearchScope>(SEARCH_SCOPE.UNREAD);
  const [standing, setStanding] = useState<TreeStanding>(TREE_READING);
  const everything = useRef<readonly FolderEntry[] | undefined>(undefined);
  const latest = useRef({ listFolder, onOpen, onViewed, file, query, only, marks });
  latest.current = { listFolder, onOpen, onViewed, file, query, only, marks };

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
    mounted.only(latest.current.only);
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

  useRegained(() => {
    if (standing.kind === TREE_STANDING.FAILED && standing.retry) handle.current?.relist();
  });

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
    handle.current?.only(only);
  }, [only]);
  useEffect(() => {
    handle.current?.mark(marks ?? []);
  }, [marks]);

  return (
    <Fill
      className="ph-no-capture"
      onKeyDown={(event) => {
        if (event.key.toLowerCase() !== "f" || !(event.metaKey || event.ctrlKey)) return;
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
  label?: string;
  over?: PaneOver | undefined;
  narrow?: boolean;
  pane?: React.Ref<HTMLElement> | undefined;
  leaving?: boolean;
  width?: number | undefined;
  edge?: ResizeEdgeHandle | undefined;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null);
  const phone = usePhoneRoom();
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
        width={
          phone ? OVER_PANE_WIDTH.FULL : narrow ? OVER_PANE_WIDTH.SHEET : OVER_PANE_WIDTH.COLUMN
        }
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
