import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { TaskCode, TaskCodeShowing, TasksTreeAnswer } from "@luke/features/tasks-view";
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
} from "@luke/ui";
import { shownFiles } from "@luke/voice/code-pane-model";
import {
  type ComponentProps,
  Fragment,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import type { FileNotes } from "./file-note.js";
import { FileTab, type ReadFileWindow } from "./file-tab.js";
import {
  FILE_READ,
  type FileRead,
  fileUrl,
  notesOf,
  shortCommit,
  WHOLE_TEXT,
  type WholeText,
  wholeTextOf,
} from "./file-tab-model.js";
import { FileTreePane } from "./file-tree-pane.js";
import { keptListings, type ListFolder, listingOf } from "./folder-listings.js";
import { linkPressOf } from "./use-open-link.js";
import { FILE_HISTORY_STEP, type FileHistoryStep, type OpenFile } from "./use-side-panel.js";
import { useViewSettingsSheet, VIEW_SETTINGS_SCOPE, ViewSettingsButton } from "./view-settings.js";

/**
 * file-view.tsx -- a File tab with the task's repository beside it: one bar across both, the file under it, and the collapsible tree on its right.
 *
 * The bar is the whole view's, the tree's column included, as an editor's
 * is: Back and Forward through the files this tab showed, the file's path
 * as breadcrumbs, then at its end the file opened on GitHub, the ⋯ of what
 * is done with it (`file-menu.tsx`), and the tree's toggle, the side
 * panel's own glyph, since the tree is docked on the right as the panel
 * is, and slides in and out as the panel does (`usePaneSlide`). The tab
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
 * by its file and the tree is not. A task with no repository draws the tab
 * alone, its path plain in the bar. A file opened at a commit, as an inbox
 * item's code or a snippet Luke read from his checkout opens it, is read at
 * that commit, its GitHub page and its copy too, the commit named quietly
 * beside the path, and drawn afresh when the same file is opened at another.
 *
 * In a side panel too narrow for the file and the tree side by side, the
 * tree stands over the file's right edge instead, shut until its toggle
 * opens it for this tab alone (`usePaneRoom`), and the crumbs fold what
 * the bar has no room for (`file-breadcrumbs.tsx`). On a phone, whose
 * task's header names the file, the bar is not drawn at all: every control
 * of it is an item of the header's ⋯ (`useTabActions`), the tree
 * standing for the crumbs, since it browses the same folders.
 *
 * The bar and the tree's slide are an agent's Changes tab's too
 * (`agent-changes-tab.tsx`), so a diff stands under the same bar, led by
 * how many of its files are viewed rather than a path, the pull request on
 * GitHub, its ⋯, and the same toggle of the same tree.
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

/** What the toggle that floats a pane over the tab answers besides its press: the pointer resting on it peeks the pane. */
interface FloatToggle {
  readonly onPointerEnter: (event: React.PointerEvent<HTMLButtonElement>) => void;
  readonly onPointerLeave: (event: React.PointerEvent<HTMLButtonElement>) => void;
}

/** One of a pane's toggles: the pane open or shut in its place, as `open` says, and a peek offering to open it. */
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
  /** The box around the button, which the pane it floats takes as its toggle: a press on it is no press outside the pane. */
  box?: RefObject<HTMLSpanElement | null> | undefined;
  words: ToggleWords;
}): React.JSX.Element {
  const label = open && !peeked ? words.open : words.closed;
  // Note that the place is the box around the button, because the stylesheet
  // shows one place by the panel's width and a barrel button wears no mark:
  // the place beside the tab stands, and the one over it waits for a narrow
  // panel (tasks.css).
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

/** A pane's toggles as its room hands them (`usePaneRoom`): beside the tab, as the panel holds it, and over it. */
export interface PaneToggles {
  readonly open: boolean;
  readonly onToggle: () => void;
  /** Whether the pane floats over the tab, peeked or opened. */
  readonly over: boolean;
  /** Whether the pane over the tab is only peeked, so a press still opens it. */
  readonly peeked: boolean;
  readonly onToggleOver: () => void;
  readonly float: FloatToggle;
  /** The box around the toggle that floats the pane. */
  readonly overBox: RefObject<HTMLSpanElement | null>;
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

/** A pane beside a tab, a File tab's tree or a Terminal tab's shells, wherever the panel's width lets it stand. */
export interface PaneRoom {
  /** The pane beside the tab, open or shut as the panel holds it for every tab of its kind. */
  readonly beside: PaneSlide;
  /** Whether the pane stands beside the tab: the panel holds it open, or it is sliding out, and the panel has room for it there. */
  readonly docked: boolean;
  /** Whether the pane is drawn at all now, beside the tab or over it. */
  readonly drawn: boolean;
  /** Whether the pane floats over the tab whenever it is shown, the panel having no room for the two side by side. */
  readonly narrow: boolean;
  /** What the pane floating over the tab is handed (`OverPane`); it stands there whenever the pane is not docked. */
  readonly over: PaneOver;
  readonly toggles: PaneToggles;
  /** Takes down the pane floating over the tab, as a file or a shell chosen in it does, to show it. */
  readonly closeOver: () => void;
  /** Shows or hides the pane where it is seen, as its toggle there does: beside the tab, or over it. */
  readonly toggle: () => void;
  /** What a strip standing in the closed pane's place wears: the pointer resting on it peeks the pane over the tab. */
  readonly strip: {
    readonly onPointerEnter: (event: React.PointerEvent<HTMLElement>) => void;
    readonly onPointerLeave: (event: React.PointerEvent<HTMLElement>) => void;
  };
  /** What the view's root wears: the marks the stylesheet places the pane by, and Escape anywhere in the view, its bar's toggle included, taking down the pane floating over the tab. */
  readonly root: {
    readonly ref: React.RefCallback<HTMLElement>;
    readonly "data-pane-beside": string;
    readonly "data-pane-over": PaneFloat;
    readonly onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  };
  /** What the box the pane stands in wears: the pointer resting at its right edge peeks the pane. */
  readonly body: { readonly onPointerMove: (event: React.PointerEvent<HTMLElement>) => void };
}

/** What the pane floating over the tab is handed: whether it stands there, whether as a peek, and the doors that put it away. */
export interface PaneOver {
  readonly open: boolean;
  readonly peek: boolean;
  /** Escape, or a press outside the pane and its toggle. */
  readonly onClose: () => void;
  /** The box around the toggle that floats it. */
  readonly toggle: RefObject<HTMLElement | null>;
  /** The pointer leaving a peek puts it away, though not for its toggle, nor a menu or a dialog the pane raised. */
  readonly onPointerLeave: (event: React.PointerEvent<HTMLElement>) => void;
}

/** How near the body's right edge, in CSS pixels, the pointer peeks the pane: the sidebar's own strip at the window's left, `--luke-space-6`. */
const PEEK_EDGE = 6;

/** The toggle that opens the pane beside the tab, which the stylesheet draws only where the pane can stand there. */
const BESIDE_TOGGLE = '.file-tree-toggle[data-place="beside"]';

/** The toggle that floats the pane over the tab, which the stylesheet draws only where the pane cannot stand beside it. */
const OVER_TOGGLE = '.file-tree-toggle[data-place="over"]';

/** The pane floated over the tab, whose box the pointer may be in. */
const OVER_PANE = ".luke-over-pane";

/** The strip a closed pane may leave in its place, which peeks the pane over the tab (`changes-strip.tsx`). */
const PANE_STRIP = ".file-tree-strip";

/**
 * Whether the view floats its pane over the tab rather than beside it,
 * which is the stylesheet's to say: its over toggle is drawn, or a strip
 * stands in the closed pane's place.
 */
function floats(view: Element | null): boolean {
  return drawnIn(view, OVER_TOGGLE) || drawnIn(view, PANE_STRIP);
}

/**
 * The pane's room. Beside the tab it is open or shut as the panel holds it
 * (`usePaneSlide`); where the panel is too narrow for the tab and the pane
 * side by side (`@container side-panel`), the stylesheet floats it over the
 * tab's right edge instead, as the main sidebar floats over the work in a
 * narrow window (`hover-pane.ts`), and only for this tab. The pointer
 * resting on its toggle or at the body's right edge peeks it, a beat later,
 * and leaving puts it away; a press of the toggle opens it, which takes the
 * keyboard and holds it. A choice in it, Escape, or a press outside puts it
 * away. It is never kept open past those, and never floats where it has
 * room beside the tab. Which of the two places stands is the stylesheet's
 * to say, read off the toggle it draws (`useFloatsOver`); the pane over the tab
 * is an `OverPane`, which slides out as it slides in.
 */
export function usePaneRoom(shown: {
  readonly open: boolean;
  readonly onToggle: () => void;
}): PaneRoom {
  const beside = usePaneSlide(shown.open);
  const [over, setOver] = useState<PaneFloat>(PANE_FLOAT.CLOSED);
  const [view, setView] = useState<HTMLElement | null>(null);
  const overBox = useRef<HTMLSpanElement | null>(null);
  // Note that a phone floats the pane whatever its width, because its tab draws no bar, and so
  // neither toggle the stylesheet would otherwise say the place by (`useTabActions`).
  const phone = usePhoneRoom();
  const narrow = useFloatsOver(view, OVER_TOGGLE, BESIDE_TOGGLE) || phone;
  const floating = over !== PANE_FLOAT.CLOSED;
  const closeOver = useCallback(() => setOver(PANE_FLOAT.CLOSED), []);
  // Note that a finger's arrival peeks nothing, because iOS plays a tap's
  // arrival as a hover and spends the tap on a pane that comes in with it:
  // a finger opens the pane with its toggle's tap alone.
  const peek = (event: React.PointerEvent) => {
    if (event.pointerType === "touch") return;
    setOver((was) => (was === PANE_FLOAT.CLOSED ? PANE_FLOAT.PEEK : was));
  };
  const unpeek = () => setOver((was) => (was === PANE_FLOAT.PEEK ? PANE_FLOAT.CLOSED : was));
  const toggleOver = () => setOver(over === PANE_FLOAT.OPEN ? PANE_FLOAT.CLOSED : PANE_FLOAT.OPEN);
  // A pane opened beside the tab floats over it no more.
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
        // A menu or a dialog the pane raised stands outside it, and is no way out either.
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
          // Note that the pointer leaving through the toggle's foot is on its way down into the pane.
          if (event.clientY >= event.currentTarget.getBoundingClientRect().bottom - 1) return;
          unpeek();
        },
      },
    },
    closeOver,
    // Note that the pane is shown beside the tab wherever it has room there,
    // a strip in its place being no float of its own.
    toggle: () => (!phone && drawnIn(view, BESIDE_TOGGLE) ? shown.onToggle() : toggleOver()),
    strip: {
      onPointerEnter: peek,
      onPointerLeave: (event) => {
        const to = event.relatedTarget;
        // Note that the pane over the tab is the pane the pointer is on its way into, as well as the docked one.
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
        // Note that the Escape is stopped here, because the window's own would leave the view.
        event.stopPropagation();
        closeOver();
      },
    },
    body: {
      onPointerMove: (event) => {
        // The edge is read from where the pointer is rather than drawn as a
        // strip, so the scrollbar under it still takes a drag, and a button
        // held, as a drag holds one, peeks nothing.
        const box = event.currentTarget.getBoundingClientRect();
        const atEdge = event.clientX >= box.right - PEEK_EDGE;
        const onPane =
          event.target instanceof Element &&
          (event.target.closest(OVER_PANE) !== null ||
            beside.pane.current?.contains(event.target) === true ||
            event.target.closest(PANE_STRIP) !== null);
        if (over === PANE_FLOAT.CLOSED && atEdge && event.buttons === 0) {
          if (floats(event.currentTarget.parentElement)) peek(event);
          return;
        }
        if (over === PANE_FLOAT.PEEK && !atEdge && !onPane) unpeek();
      },
    },
  };
}

/**
 * The most of the box it stands in the tree takes, which the stylesheet
 * holds it to as well (`.file-tree-pane`'s 40%), so a drag starts from the
 * width drawn and the code or diff beside it keeps the larger column.
 */
const TREE_SHARE = 0.4;

/** What a drag of the tree leaves the tab beside it in their box, in CSS pixels: the rest of the box past the tree's share. */
function tabReserve(box: HTMLElement): number {
  return box.getBoundingClientRect().width * (1 - TREE_SHARE);
}

/** The tree as the panel holds it for every File and Changes tab: open or not, and how wide. */
export interface TreeShown {
  readonly open: boolean;
  readonly onToggle: () => void;
  /** Its width and the drag that asks for another; none draws it at its default width with no edge. */
  readonly width?: FileTreeWidth | undefined;
}

/**
 * The edge the tree beside a tab is dragged by, on its left: between its
 * bounds, leaving the tab its room, shut by a drag past its least width,
 * reset by a double-click; none where the panel keeps no width for it.
 * Note that it is called by the view, which outlives the tree a drag shuts.
 */
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
/** A view's Back and Forward, a list's gap apart, beside its path in the bar, a File tab's and a Browser tab's alike. */
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

/** The path a File tab's bar names, and the repository it browses, whose folders its breadcrumbs list; none names the path plain. */
interface BarPath {
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

/** A File tab's path in its bar: as breadcrumbs where the repository is browsed, else plain. */
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

/** A pane's toggle as an item of a phone's ⋯: Show or Hide, as the pane floating over the tab stands, its press as the toggle's. */
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

/** Open on GitHub as an item of a phone's ⋯, dimmed with no page to open yet, as the bar's button is. */
export function gitHubAction(onGitHub: (() => void) | undefined, detail?: string): MenuAction {
  return {
    label: "Open on GitHub",
    icon: <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />,
    detail,
    disabled: onGitHub === undefined,
    onSelect: () => onGitHub?.(),
  };
}

/** A bar's ⋯ as groups of a phone's ⋯, a submenu's items standing in its group, since a ⋯ nests no menu. */
export function barMenuItems(more: PaneBarMenu | undefined): MenuAction[][] {
  return (more?.groups ?? []).map((group) =>
    group.flatMap((entry) => ("items" in entry ? [...entry.items] : [entry])),
  );
}

/** Back and Forward through the files a File tab showed, as items of a phone's ⋯, dimmed as the bar's buttons are. */
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

/**
 * The bar across a File tab and its tree, or a Changes tab and its own, drawn
 * by `PaneBar`: Back and Forward where the tab keeps a history, then what
 * leads it (a File tab's path, or Files changed's count of the files
 * viewed), the GitHub button, dimmed with no page to open yet, the tab's own
 * controls, the tree's toggle where there is a tree, and the ⋯ last.
 */
export function FileViewBar({
  history,
  lead,
  github,
  menu,
  more,
  tree,
}: {
  history?: FileHistory | undefined;
  /** What leads the bar after Back and Forward: a File tab's path and the commit it is read at, or Files changed's count. */
  lead: ReactNode;
  /** The page on GitHub, and the door that opens it; none dims the button. */
  github: { readonly href: string; readonly open: (url: string) => void } | undefined;
  /** The tab's own controls after the GitHub button: View settings, or a ⋯ of its own. */
  menu: ReactNode;
  /** The bar's ⋯, drawn last, after the tree's toggle; none draws none. */
  more?: PaneBarMenu | undefined;
  /** The tree's toggles, where there is a tree. */
  tree?: PaneToggles | undefined;
}): React.JSX.Element {
  // Note that a path stands among the controls, since Back and Forward come before it, and a count with no history leads the bar as words do.
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
          {tree === undefined ? null : <TreeToggle toggles={tree} />}
        </>
      }
      menu={more}
    />
  );
}

/** The file as the tab last told its read, a read of a file or a commit shown before standing for nothing. */
interface TabRead {
  readonly path: string;
  readonly commit: string | undefined;
  readonly read: FileRead;
}

/** The end of a File tab's bar: View settings, offering the settings its lines follow, then its ⋯. */
export function useFileViewEnd(
  props: Parameters<typeof useFileMenu>[0],
): Pick<ComponentProps<typeof FileViewBar>, "menu" | "more"> {
  return {
    menu: <ViewSettingsButton scope={{ kind: VIEW_SETTINGS_SCOPE.LINES, notes: true }} />,
    more: useFileMenu(props),
  };
}

/** What the tab is keyed by while it reads the default branch's head rather than a commit. */
const HEAD_READ = "head";

export function FileView({
  taskId,
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
  treeWidth,
  onBrowse,
  history,
  onFoldNote,
  agentLabel,
}: {
  taskId: string;
  /** The task's repository, `owner/name`, which the tree browses; none draws the tab alone. */
  repository: string | null;
  file: OpenFile;
  /** The lines Luke showed of the file, drawn where the file cannot be. */
  snippet: TaskCode | undefined;
  /** Every code Luke showed on the task, whose files of this repository the tree's filter narrows to. */
  shownCode: readonly TaskCodeShowing[] | undefined;
  readFile: ReadFileWindow;
  /** Lists one folder of the repository through the service. */
  readFolder: ListFolder;
  /** Lists the whole repository in one read through the service, which the tree's search narrows. */
  readWhole: () => Promise<TasksTreeAnswer>;
  openGitHub: (url: string) => void;
  treeOpen: boolean;
  onToggleTree: () => void;
  /** How wide the tree stands, and the drag that asks for another width; none draws it at its default width. */
  treeWidth?: FileTreeWidth | undefined;
  /** A file chosen in the tree or the breadcrumbs, to show in this tab, or in a tab of its own where `newTab` asks. */
  onBrowse: (path: string, newTab: boolean) => void;
  history: FileHistory;
  /** Folds or opens the note of the call that showed lines of the file, on this tab. */
  onFoldNote: FileNotes["onFold"];
  /** An agent on the task as its tab names it, which heads its notes on the file; none for an agent not listed. */
  agentLabel?: FileNotes["agentLabel"];
}): React.JSX.Element {
  // The view's store of listings, one per task and repository. Note that
  // it lists through a ref to the latest door, so a parent drawing a fresh
  // door neither forgets the listings nor lists the root again.
  const latestRead = useRef(readFolder);
  latestRead.current = readFolder;
  const latestWhole = useRef(readWhole);
  latestWhole.current = readWhole;
  const listFolder = useMemo(
    () => keptListings((path) => latestRead.current(path)),
    [taskId, repository],
  );
  // The whole repository is kept beside the folders, read once however many
  // File tabs search it.
  const listWhole = useMemo(() => {
    const kept = keptListings(() => latestWhole.current());
    return () => kept("");
  }, [taskId, repository]);

  // Note that the list is kept while the task shows nothing new, because
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
    taskId,
    agentLabel,
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
  // The whole text, for a copy or a download: the text the tab draws, so a
  // copy holds the lines shown at the commit they were read at, or, before
  // the tab holds it, read raw through the tab's door in one read.
  const readText = (): Promise<WholeText> =>
    read.kind === FILE_READ.READY
      ? Promise.resolve({ kind: WHOLE_TEXT.READ, text: read.text })
      : readAt({ path: file.path, firstLine: 1, lastLine: 1, raw: true }).then(wholeTextOf, () => ({
          kind: WHOLE_TEXT.UNREAD,
        }));
  const fileViewEnd = useFileViewEnd({
    path: file.path,
    ready: read.kind === FILE_READ.READY,
    readText,
  });

  // The tree and the breadcrumbs hear each folder in the tree's own words.
  const readFolderListing: ReadFolder = useCallback(
    (path) => listFolder(path).then(listingOf),
    [listFolder],
  );
  const browsing = repository !== null;
  const tree = usePaneRoom({ open: browsing && treeOpen, onToggle: onToggleTree });
  const edge = useTreeEdge({ open: treeOpen, onToggle: onToggleTree, width: treeWidth });
  // A file chosen in the tree floating over the tab takes the tree down, to show the file.
  const browse = (path: string, newTab: boolean) => {
    tree.closeOver();
    onBrowse(path, newTab);
  };
  const ready = read.kind === FILE_READ.READY;
  const onGitHub = ready ? () => openGitHub(fileUrl(read, file)) : undefined;
  // A phone draws no bar: the header's ⋯ offers every control of it, in its order.
  const phone = usePhoneRoom();
  const settings = useViewSettingsSheet({ kind: VIEW_SETTINGS_SCOPE.LINES, notes: true });
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
        {browsing ? (
          <FileTreePane
            file={file.path}
            shown={shown}
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
