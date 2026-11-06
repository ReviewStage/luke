import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import type { TasksTreeAnswer } from "@repo/features/tasks-view";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BreadcrumbBar,
  FILL_FLOW,
  Fill,
  IconButton,
  IconButtonLink,
  PaneBar,
  type PaneBarMenu,
  ProviderMark,
  RESIZE_EDGE_SIDE,
  type ResizeEdgeHandle,
  SidePanelIcon,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_TRUNCATE,
  TEXT_VARIANT,
  Text,
  Tooltip,
  useResizeEdge,
} from "@repo/ui";
import { useQueryClient } from "@tanstack/react-query";
import {
  type ComponentProps,
  Fragment,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import type { MenuAction } from "../desktop/action-menu.js";
import { FILE_TREE_WIDTH, type FileTreeWidth } from "../desktop/folded-groups.js";
import { KEY_LAYERS, PANE_FLOAT, type PaneFloat } from "../desktop/hover-pane.js";
import { type PaneSlide, usePaneSlide } from "../desktop/pane-motion.js";
import { useTabActions } from "../desktop/strip-tabs.js";
import type { ReadFolder } from "../file-tree/contract.js";
import { usePhoneRoom } from "../stage-room.js";
import { drawnIn, useFloatsOver } from "./drawn-in.js";
import { FileBreadcrumbs } from "./file-breadcrumbs.js";
import { useFileMenu } from "./file-menu.js";
import { FileTab } from "./file-tab.js";
import {
  FILE_READ,
  type FileRead,
  fileUrl,
  shortCommit,
  WHOLE_TEXT,
  type WholeText,
  wholeTextOf,
} from "./file-tab-model.js";
import { FileTreePane } from "./file-tree-pane.js";
import { listingOf } from "./folder-listings.js";
import {
  ReadRefused,
  refusedAnswer,
  taskFileQueryOptions,
  taskTreeKey,
  taskTreeQueryOptions,
} from "./repository-reads.js";
import { linkPressOf } from "./use-open-link.js";
import {
  FILE_HISTORY_STEP,
  type FileHistoryStep,
  type FileReadPlace,
  type OpenFile,
} from "./use-side-panel.js";
import { useViewSettingsSheet, VIEW_SETTINGS_SCOPE, ViewSettingsButton } from "./view-settings.js";

interface ToggleWords {
  readonly open: string;
  readonly closed: string;
}

const FILES_TOGGLE: ToggleWords = { open: "Hide files", closed: "Show files" };

const PANE_PLACE = { BESIDE: "beside", OVER: "over" } as const;

type PanePlace = (typeof PANE_PLACE)[keyof typeof PANE_PLACE];

interface FloatToggle {
  readonly onPointerEnter: (event: React.PointerEvent<HTMLButtonElement>) => void;
  readonly onPointerLeave: (event: React.PointerEvent<HTMLButtonElement>) => void;
}

function PlaceToggle({
  place,
  open,
  peeked,
  onToggle,
  float,
  box,
  words,
}: {
  place: PanePlace;
  open: boolean;
  peeked: boolean;
  onToggle: () => void;
  float: FloatToggle | undefined;
  box?: RefObject<HTMLSpanElement | null> | undefined;
  words: ToggleWords;
}): React.JSX.Element {
  const label = open && !peeked ? words.open : words.closed;
  return (
    <span ref={box} className="file-tree-toggle flex data-[place=over]:hidden" data-place={place}>
      <Tooltip label={label}>
        <IconButton
          icon={<SidePanelIcon />}
          label={label}
          aria-expanded={open}
          onClick={onToggle}
          onPointerEnter={float?.onPointerEnter}
          onPointerLeave={float?.onPointerLeave}
        />
      </Tooltip>
    </span>
  );
}

export interface PaneToggles {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly over: boolean;
  readonly peeked: boolean;
  readonly onToggleOver: () => void;
  readonly float: FloatToggle;
  readonly overBox: RefObject<HTMLSpanElement | null>;
}

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
        peeked={false}
        onToggle={toggles.onToggle}
        float={undefined}
        words={words}
      />
      <PlaceToggle
        place={PANE_PLACE.OVER}
        open={toggles.over}
        peeked={toggles.peeked}
        onToggle={toggles.onToggleOver}
        float={toggles.float}
        box={toggles.overBox}
        words={words}
      />
    </>
  );
}

export interface PaneRoom {
  readonly beside: PaneSlide;
  readonly docked: boolean;
  readonly drawn: boolean;
  readonly narrow: boolean;
  readonly over: PaneOver;
  readonly toggles: PaneToggles;
  readonly closeOver: () => void;
  readonly toggle: () => void;
  readonly strip: {
    readonly onPointerEnter: (event: React.PointerEvent<HTMLElement>) => void;
    readonly onPointerLeave: (event: React.PointerEvent<HTMLElement>) => void;
  };
  readonly root: {
    readonly ref: React.RefCallback<HTMLElement>;
    readonly "data-pane-beside": string;
    readonly "data-pane-over": PaneFloat;
    readonly onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  };
  readonly body: { readonly onPointerMove: (event: React.PointerEvent<HTMLElement>) => void };
}

export interface PaneOver {
  readonly open: boolean;
  readonly peek: boolean;
  readonly onClose: () => void;
  readonly toggle: RefObject<HTMLElement | null>;
  readonly onPointerLeave: (event: React.PointerEvent<HTMLElement>) => void;
}

const PEEK_EDGE = 6;

const BESIDE_TOGGLE = '.file-tree-toggle[data-place="beside"]';

const OVER_TOGGLE = '.file-tree-toggle[data-place="over"]';

const OVER_PANE = ".ui-over-pane";

const PANE_STRIP = ".file-tree-strip";

function floats(view: Element | null, toggles: Element | null): boolean {
  return drawnIn(toggles, OVER_TOGGLE) || drawnIn(view, PANE_STRIP);
}

export function usePaneRoom(
  shown: {
    readonly open: boolean;
    readonly onToggle: () => void;
  },
  host?: Element | null,
): PaneRoom {
  const beside = usePaneSlide(shown.open);
  const [over, setOver] = useState<PaneFloat>(PANE_FLOAT.CLOSED);
  const [view, setView] = useState<HTMLElement | null>(null);
  const toggled = host === undefined ? view : host;
  const overBox = useRef<HTMLSpanElement | null>(null);
  const phone = usePhoneRoom();
  const narrow = useFloatsOver(toggled, OVER_TOGGLE, BESIDE_TOGGLE) || phone;
  const floating = over !== PANE_FLOAT.CLOSED;
  const closeOver = useCallback(() => setOver(PANE_FLOAT.CLOSED), []);
  const peek = (event: React.PointerEvent) => {
    if (event.pointerType === "touch") return;
    setOver((was) => (was === PANE_FLOAT.CLOSED ? PANE_FLOAT.PEEK : was));
  };
  const unpeek = () => setOver((was) => (was === PANE_FLOAT.PEEK ? PANE_FLOAT.CLOSED : was));
  const toggleOver = () => setOver(over === PANE_FLOAT.OPEN ? PANE_FLOAT.CLOSED : PANE_FLOAT.OPEN);
  useEffect(() => {
    if (shown.open) setOver(PANE_FLOAT.CLOSED);
  }, [shown.open]);
  const docked = !narrow && beside.drawn;
  return {
    beside,
    docked,
    drawn: docked || floating,
    narrow,
    over: {
      open: floating,
      peek: over === PANE_FLOAT.PEEK,
      onClose: closeOver,
      toggle: overBox,
      onPointerLeave: (event) => {
        if (over !== PANE_FLOAT.PEEK) return;
        const to = event.relatedTarget;
        if (to instanceof Element && (to.closest(OVER_TOGGLE) ?? to.closest(KEY_LAYERS)) !== null) {
          return;
        }
        closeOver();
      },
    },
    toggles: {
      ...shown,
      over: floating,
      peeked: over === PANE_FLOAT.PEEK,
      onToggleOver: toggleOver,
      overBox,
      float: {
        onPointerEnter: peek,
        onPointerLeave: (event) => {
          if (event.clientY >= event.currentTarget.getBoundingClientRect().bottom - 1) return;
          unpeek();
        },
      },
    },
    closeOver,
    toggle: () => (!phone && drawnIn(toggled, BESIDE_TOGGLE) ? shown.onToggle() : toggleOver()),
    strip: {
      onPointerEnter: peek,
      onPointerLeave: (event) => {
        const to = event.relatedTarget;
        if (to instanceof Element && to.closest(OVER_PANE) !== null) return;
        if (to instanceof Node && beside.pane.current?.contains(to)) return;
        unpeek();
      },
    },
    root: {
      ref: setView,
      "data-pane-beside": String(beside.drawn),
      "data-pane-over": over,
      onKeyDown: (event) => {
        if (!floating || event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.stopPropagation();
        closeOver();
      },
    },
    body: {
      onPointerMove: (event) => {
        const box = event.currentTarget.getBoundingClientRect();
        const atEdge = event.clientX >= box.right - PEEK_EDGE;
        const onPane =
          event.target instanceof Element &&
          (event.target.closest(OVER_PANE) !== null ||
            beside.pane.current?.contains(event.target) === true ||
            event.target.closest(PANE_STRIP) !== null);
        if (over === PANE_FLOAT.CLOSED && atEdge && event.buttons === 0) {
          if (floats(event.currentTarget.parentElement, toggled)) peek(event);
          return;
        }
        if (over === PANE_FLOAT.PEEK && !atEdge && !onPane) unpeek();
      },
    },
  };
}

const TREE_SHARE = 0.4;

function tabReserve(box: HTMLElement): number {
  return box.getBoundingClientRect().width * (1 - TREE_SHARE);
}

export interface TreeShown {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly width?: FileTreeWidth | undefined;
}

export function useTreeEdge(tree: TreeShown): ResizeEdgeHandle | undefined {
  const width = tree.width;
  const edge = useResizeEdge({
    side: RESIZE_EDGE_SIDE.LEFT,
    width: width?.width ?? FILE_TREE_WIDTH.DEFAULT,
    bounds: FILE_TREE_WIDTH,
    reserve: tabReserve,
    label: "Resize files",
    onResize: (asked) => width?.onResize(asked),
    onToggleCollapsed: tree.onToggle,
  });
  return width === undefined ? undefined : edge;
}

export interface FileHistory {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly onStep: (step: FileHistoryStep) => void;
}

export const FILE_VIEW_HISTORY_CLASS = "flex flex-none items-center gap-list-gap";

function HistoryButtons({ history }: { history: FileHistory }): React.JSX.Element {
  return (
    <div className={FILE_VIEW_HISTORY_CLASS}>
      <Tooltip label="Back">
        <IconButton
          icon={<ArrowLeftIcon />}
          label="Back"
          disabled={!history.canGoBack}
          onClick={() => history.onStep(FILE_HISTORY_STEP.BACK)}
        />
      </Tooltip>
      <Tooltip label="Forward">
        <IconButton
          icon={<ArrowRightIcon />}
          label="Forward"
          disabled={!history.canGoForward}
          onClick={() => history.onStep(FILE_HISTORY_STEP.FORWARD)}
        />
      </Tooltip>
    </div>
  );
}

interface BarPath {
  readonly path: string;
  readonly browse:
    | {
        readonly repository: string;
        readonly listFolder: ReadFolder;
        readonly onOpen: (path: string, newTab: boolean) => void;
      }
    | undefined;
}

function BarPathWords({ path }: { path: BarPath }): React.JSX.Element {
  const { browse } = path;
  if (browse === undefined) {
    return (
      <Tooltip label={path.path}>
        <Text
          as={TEXT_ELEMENT.SPAN}
          variant={TEXT_VARIANT.INHERIT}
          font={TEXT_FONT.MONO}
          truncate={TEXT_TRUNCATE.START}
          className="file-view-path"
        >
          <bdi>{path.path}</bdi>
        </Text>
      </Tooltip>
    );
  }
  return (
    <FileBreadcrumbs
      repository={browse.repository}
      path={path.path}
      listFolder={browse.listFolder}
      onOpen={browse.onOpen}
    />
  );
}

export function paneToggleAction(
  room: PaneRoom,
  words: ToggleWords = FILES_TOGGLE,
  detail?: string,
): MenuAction {
  return {
    label: room.toggles.over && !room.toggles.peeked ? words.open : words.closed,
    icon: <SidePanelIcon />,
    detail,
    onSelect: room.toggle,
  };
}

export function gitHubAction(onGitHub: (() => void) | undefined, detail?: string): MenuAction {
  return {
    ...commandAction(PANEL_COMMAND.OPEN_ON_GITHUB, () => onGitHub?.(), false),
    detail,
    disabled: onGitHub === undefined,
  };
}

export function barMenuItems(more: PaneBarMenu | undefined): MenuAction[][] {
  return (more?.groups ?? []).map((group) =>
    group.flatMap((entry) =>
      "items" in entry ? [...entry.items] : "panel" in entry ? [] : [entry],
    ),
  );
}

function historyActions(history: FileHistory): MenuAction[] {
  return [
    {
      label: "Back",
      icon: <ArrowLeftIcon />,
      disabled: !history.canGoBack,
      onSelect: () => history.onStep(FILE_HISTORY_STEP.BACK),
    },
    {
      label: "Forward",
      icon: <ArrowRightIcon />,
      disabled: !history.canGoForward,
      onSelect: () => history.onStep(FILE_HISTORY_STEP.FORWARD),
    },
  ];
}

export function FileViewBar({
  history,
  lead,
  github,
  menu,
  more,
  tree,
}: {
  history?: FileHistory | undefined;
  lead?: ReactNode;
  github: { readonly href: string; readonly open: (url: string) => void } | undefined;
  menu: ReactNode;
  more?: PaneBarMenu | undefined;
  tree?: PaneToggles | undefined;
}): React.JSX.Element {
  const crumbs = history !== undefined;
  return (
    <PaneBar
      middle={
        crumbs ? (
          <BreadcrumbBar>
            <HistoryButtons history={history} />
            {lead}
          </BreadcrumbBar>
        ) : null
      }
      detail={crumbs ? undefined : lead}
      actions={
        <>
          <Tooltip label="Open on GitHub">
            {github === undefined ? (
              <IconButton
                icon={<ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />}
                label="Open on GitHub"
                disabled
              />
            ) : (
              <IconButtonLink
                icon={<ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />}
                label="Open on GitHub"
                href={github.href}
                onClick={linkPressOf(github.open, github.href)}
              />
            )}
          </Tooltip>
          {menu}
        </>
      }
      menu={more}
      end={tree === undefined ? undefined : <TreeToggle toggles={tree} />}
    />
  );
}

interface TabRead {
  readonly path: string;
  readonly commit: string | undefined;
  readonly read: FileRead;
}

export function useFileViewEnd(
  props: Parameters<typeof useFileMenu>[0],
): Pick<ComponentProps<typeof FileViewBar>, "menu" | "more"> {
  return {
    menu: <ViewSettingsButton scope={{ kind: VIEW_SETTINGS_SCOPE.LINES }} />,
    more: useFileMenu(props),
  };
}

const HEAD_READ = "head";

export function FileView({
  place,
  repository,
  file,
  openGitHub,
  treeOpen,
  onToggleTree,
  treeWidth,
  onBrowse,
  history,
}: {
  place: FileReadPlace;
  repository: string | null;
  file: OpenFile;
  openGitHub: (url: string) => void;
  treeOpen: boolean;
  onToggleTree: () => void;
  treeWidth?: FileTreeWidth | undefined;
  onBrowse: (path: string, newTab: boolean) => void;
  history: FileHistory;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const latestPlace = useRef(place);
  latestPlace.current = place;
  const taskId = "taskId" in place ? place.taskId : undefined;
  const workspaceId = "workspaceId" in place ? place.workspaceId : undefined;
  const readRepository = "repository" in place ? place.repository : undefined;
  useEffect(() => {
    void queryClient.invalidateQueries({
      queryKey: taskTreeKey(latestPlace.current),
      refetchType: "none",
    });
  }, [queryClient, taskId, workspaceId, readRepository]);
  const listFolder = useCallback(
    (path: string, recursive = false): Promise<TasksTreeAnswer> =>
      queryClient
        .fetchQuery(taskTreeQueryOptions(latestPlace.current, path, recursive))
        .catch((error: unknown): TasksTreeAnswer => refusedAnswer(error)),
    [queryClient],
  );
  const listWhole = useCallback(() => listFolder("", true), [listFolder]);

  const commit = file.commit;

  const [told, setTold] = useState<TabRead | undefined>(undefined);
  const read =
    told?.path === file.path && told.commit === commit ? told.read : { kind: FILE_READ.READING };
  const onRead = useCallback(
    (next: FileRead) => setTold({ path: file.path, commit, read: next }),
    [file.path, commit],
  );
  const readText = (): Promise<WholeText> =>
    read.kind === FILE_READ.READY
      ? Promise.resolve({ kind: WHOLE_TEXT.READ, text: read.text })
      : queryClient
          .fetchQuery(
            taskFileQueryOptions(place, {
              path: file.path,
              firstLine: 1,
              lastLine: 1,
              raw: true,
              ...(commit === undefined ? undefined : { ref: commit }),
            }),
          )
          .then(wholeTextOf, (error: unknown) =>
            error instanceof ReadRefused
              ? wholeTextOf(error.answer)
              : { kind: WHOLE_TEXT.UNREAD, cause: error },
          );
  const fileViewEnd = useFileViewEnd({
    path: file.path,
    ready: read.kind === FILE_READ.READY,
    readText,
  });

  const readFolderListing: ReadFolder = useCallback(
    (path) => listFolder(path).then(listingOf),
    [listFolder],
  );
  const browsing = repository !== null;
  const tree = usePaneRoom({ open: browsing && treeOpen, onToggle: onToggleTree });
  const edge = useTreeEdge({ open: treeOpen, onToggle: onToggleTree, width: treeWidth });
  const browse = (path: string, newTab: boolean) => {
    tree.closeOver();
    onBrowse(path, newTab);
  };
  const ready = read.kind === FILE_READ.READY;
  const onGitHub = ready ? () => openGitHub(fileUrl(read, file)) : undefined;
  const phone = usePhoneRoom();
  const settings = useViewSettingsSheet({ kind: VIEW_SETTINGS_SCOPE.LINES });
  useTabActions(
    phone
      ? [
          historyActions(history),
          [
            ...(browsing ? [paneToggleAction(tree, FILES_TOGGLE, file.path)] : []),
            gitHubAction(
              onGitHub,
              commit === undefined ? undefined : `Read at commit ${shortCommit(commit)}`,
            ),
            settings.action,
          ],
          ...barMenuItems(fileViewEnd.more),
        ]
      : undefined,
  );
  return (
    <Fill className="file-view" {...tree.root}>
      {phone ? (
        settings.sheet
      ) : (
        <FileViewBar
          history={history}
          lead={
            <>
              <BarPathWords
                path={{
                  path: file.path,
                  browse: browsing
                    ? { repository, listFolder: readFolderListing, onOpen: onBrowse }
                    : undefined,
                }}
              />
              {commit === undefined ? null : (
                <Tooltip label={`Read at commit ${commit}`}>
                  <span className="flex-none whitespace-nowrap font-mono text-muted-foreground">
                    {shortCommit(commit)}
                  </span>
                </Tooltip>
              )}
            </>
          }
          github={
            read.kind === FILE_READ.READY
              ? { href: fileUrl(read, file), open: openGitHub }
              : undefined
          }
          {...fileViewEnd}
          tree={browsing ? tree.toggles : undefined}
        />
      )}
      <Fill flow={FILL_FLOW.ROW} clip className="file-view-body relative" {...tree.body}>
        <Fragment key={file.path}>
          <FileTab key={commit ?? HEAD_READ} place={place} file={file} onRead={onRead} />
        </Fragment>
        {browsing ? (
          <FileTreePane
            file={file.path}
            listFolder={readFolderListing}
            readWhole={listWhole}
            onOpen={browse}
            over={tree.docked ? undefined : tree.over}
            narrow={tree.narrow}
            pane={tree.beside.pane}
            leaving={tree.beside.leaving}
            width={treeWidth?.width}
            edge={edge}
          />
        ) : null}
      </Fill>
    </Fill>
  );
}
