import type { AccountSnapshot } from "@repo/credentials/snapshot";
import type { AgentSummary, TasklessAgent } from "@repo/features/agent-wire";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import {
  inPinOrder,
  type PinPlace,
  pinPositionsForInsert,
  pinPositionsForMove,
} from "@repo/features/pin-order";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { TaskSectionWrite } from "@repo/features/task-section-wire";
import { isAgentEntry, type SectionMember } from "@repo/features/task-section-writes";
import type { TaskAgentPin, TaskSummary } from "@repo/features/task-wire";
import type { UpdateControl } from "@repo/settings/settings-controls";
import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  AVATAR_SIZE,
  BUTTON_SIZE,
  Button,
  ComposeIcon,
  commandKeyshortcuts,
  DropSlot,
  dropBelowStart,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  Fill,
  GROUP_HEADING,
  GroupHeader,
  HoldPress,
  IconButton,
  joinRefs,
  ListMotion,
  MoreButton,
  motionKey,
  motionRows,
  NAV_COUNT_SHOWN,
  NAV_CURRENT,
  NavItem,
  NOTE_LINE_LOOK,
  NoRepositoryGlyph,
  NoteLine,
  opensMenu,
  PanePin,
  PinIcon,
  PLAIN_PRESS,
  ProviderMark,
  RESIZE_EDGE_SIDE,
  RepositoryName,
  RepositoryPicture,
  ResizeEdge,
  type ResizeEdgeHandle,
  reachedKey,
  rovingItemIn,
  SCROLL_FADE,
  ScrollArea,
  SearchIcon,
  SelectionRegion,
  Shortcut,
  SidebarPlaces,
  SidebarRule,
  Skeleton,
  SkeletonRegion,
  STATUS_TONE,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  Tooltip,
  UnpinIcon,
  useLeaving,
  useMenu,
  useMinute,
  useResizeEdge,
  useRovingKeys,
  VisuallyHidden,
} from "@repo/ui";
import { FolderPlusIcon, HouseIcon, ListTodoIcon, ShieldUserIcon, ZapIcon } from "@repo/ui/icons";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { agentTab, STRIP_TAB_KIND, sameTab } from "@repo/ui/tab-strip-model";
import {
  ASSIGNED_TO,
  type AssignedTo,
  agentRow,
  type ChildTaskCount,
  childTaskCounts,
  type DrawnTaskRow,
  drawnTaskRows,
  hiddenStatuses,
  homedTaskRows,
  NO_REPOSITORY,
  openParentIds,
  orderTaskRows,
  type RepositoryGroup,
  repositoryGroups,
  repositoryLabel,
  SHOWN_STATUSES,
  TASK_GROUPING,
  TASK_ROW,
  type TaskRow,
  taskRow,
  taskRowInStatuses,
  taskRowKey,
  taskRowRepository,
  taskRowsAssignedTo,
  taskRowsInStatuses,
  taskRowTime,
} from "@repo/ui/task-list-model";
import {
  memberSection,
  placeWrites,
  sectionOrder,
  unplaceAllWrites,
  workspaceSections,
} from "@repo/ui/task-sections-model";
import { repositoryPageUrl, TASK_MARK, TASKS_PAGE } from "@repo/ui/tasks-model";
import { useVirtualRuns, VIRTUAL_ROW_KEY_ATTRIBUTE } from "@repo/ui/virtual-rows";
import { useQuery } from "@tanstack/react-query";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { runAppCommand, useAppCommand } from "../app-commands.js";
import { useNewTaskDrafted } from "../composer-drafts.js";
import { useConnected } from "../connection.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { DraftMark } from "../draft-mark.js";
import { unreadShown } from "../failure-report.js";
import { useFindOpen } from "../find-in-tab.js";
import { MemberDirectory, useMemberDirectory } from "../member-directory.js";
import {
  type HistoryPage,
  type HistoryStep,
  type NavigationHistory,
  sameHistoryPage,
} from "../navigation-history.js";
import {
  endWindowSpan,
  leaveWindowSpan,
  PANEL_SPAN,
  PANEL_SPAN_ATTRIBUTE,
} from "../panel-spans.js";
import { PANEL_TAB, type PanelTab } from "../panel-tabs.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { GLYPH_STATE, stateEndMark } from "../state-glyph.js";
import { agentName } from "../tasks/agent-model.js";
import { useHeldOrder } from "../tasks/use-held-order.js";
import {
  type AgentPin,
  isAgentPin,
  type PinnedTab,
  SIDE_PANEL_TAB,
  type SidebarPin,
  samePin,
} from "../tasks/use-side-panel.js";
import { useUnreadTasks } from "../tasks/use-task-looks.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { appStateQuery, selectAdminAccess } from "../use-app-state.js";
import { IDLE_TIMEOUT_MS, useWhenIdle } from "../use-when-idle.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "./action-menu.js";
import { runningRuns } from "./automation-runs-tab.js";
import { useFailedRunsMark } from "./failed-runs.js";
import { withoutFinishedRuns, withoutFinishedRunTasks } from "./finished-runs.js";
import { type FoldedGroups, useFoldedGroups } from "./folded-groups.js";
import { type HoverPane, useHoverPane } from "./hover-pane.js";
import {
  childTasksFold,
  listedSlot,
  movedBeside,
  nestsOf,
  storedSlot,
  useNestedRows,
} from "./nested-rows.js";
import { NewTaskInButton } from "./new-task-button.js";
import { PhoneAccount } from "./phone-account.js";
import { PhoneHead } from "./phone-head.js";
import { useInboxWaiting } from "./places-waiting.js";
import { ProductIdentity } from "./product-identity.js";
import { RowPlaced, useRowMoveKeys } from "./row-moves.js";
import { SidebarAgent } from "./sidebar-agent.js";
import { SIDEBAR_WIDTH, type SidebarCollapse, sidebarInSight } from "./sidebar-collapse.js";
import { type CountNoun, foldedCount, sidebarFold, TASK_NOUN } from "./sidebar-fold.js";
import { SidebarFoot } from "./sidebar-foot.js";
import { SidebarInboxRow } from "./sidebar-inbox-row.js";
import { SidebarPinnedTab } from "./sidebar-pinned-tab.js";
import { SidebarRun, type SidebarRunsPlace } from "./sidebar-run.js";
import {
  type DrawnSection,
  moveToSectionEntry,
  NEW_SECTION,
  PINNED_DROP_ZONE,
  rowMember,
  type ShownSection,
  SidebarSections,
  TASKS_DROP_ZONE,
  useSectionDialogs,
  useSectionEdits,
} from "./sidebar-sections.js";
import {
  HiddenStatusesLine,
  NONE_MATCH,
  TaskViewOptions,
  tasksHeadWords,
  useTaskViewCommands,
} from "./sidebar-task-view.js";
import { type RowFaces, SidebarTask } from "./task-actions.js";
import { useTaskListView } from "./task-list-view.js";
import { ChosenTasksContext, useTasksSelection } from "./tasks-selection.js";
import { useWorkspaceRuns } from "./use-automation-runs.js";
import { useRunRowDrag } from "./use-row-drag.js";
import { WorkspaceSwitcher } from "./workspace-switcher.js";

/**
 * What the sidebar leaves the work column beside it, in CSS pixels: the
 * sidebar is dragged no wider than the window less this.
 */
const WORK_RESERVE = 360;

/** What the Automations row's count counts, as a reader hears it after the figure. */
const RUNNING_NOUN = "running";

/** The widths of the tasks' names while the list is first read, uneven as names are. */
const LIST_SKELETON = ["72%", "54%", "64%", "46%"] as const;

/**
 * The edge of the window's left column, the tasks' sidebar or Settings' page
 * list, which share one width: resizing either resizes both. `onCollapse`
 * folds the column away past its least width; without it, as in Settings,
 * where there is no tasks' sidebar to fold, the drag holds at the bound.
 */
export function useSidebarEdge(
  sidebar: SidebarCollapse,
  onToggleCollapsed?: () => void,
): ResizeEdgeHandle {
  return useResizeEdge({
    side: RESIZE_EDGE_SIDE.RIGHT,
    width: sidebar.width,
    bounds: SIDEBAR_WIDTH,
    reserve: () => WORK_RESERVE,
    label: "Resize sidebar",
    onResize: sidebar.onResize,
    onToggleCollapsed,
  });
}

/**
 * Back and forward, at the right of the left column's title-bar row, level
 * with the traffic lights, the way Cursor and Codex keep them: in the
 * column, so they ride its right edge as it is dragged and slide away with
 * it when it folds, after the column's drag strip so they claim their
 * presses back from the window frame. A way with nothing along it is dimmed
 * rather than gone, so neither button moves. The chords are the shell's to
 * offer, since they answer while the column is folded too. A phone draws
 * none: its places bar and each page's own Back are how it moves, and the
 * drawer's head is short of room.
 */
export function HistoryButtons({
  history,
  room,
}: {
  history: NavigationHistory;
  room: ShellRoom;
}): React.JSX.Element | null {
  if (room === SHELL_ROOM.NARROW) return null;
  return (
    <div className="title-bar-controls" data-edge="column">
      <HistoryButton
        label="Back"
        command={APP_COMMAND.BACK}
        icon={<ArrowLeftIcon />}
        able={history.canGoBack}
        onPress={history.onBack}
        steps={history.steps.back}
        onGoTo={history.onGoTo}
      />
      <HistoryButton
        label="Forward"
        command={APP_COMMAND.FORWARD}
        icon={<ArrowRightIcon />}
        able={history.canGoForward}
        onPress={history.onForward}
        steps={history.steps.forward}
        onGoTo={history.onGoTo}
      />
    </div>
  );
}

/** The steps a list names a step by where nothing named it as the window stood on it. */
const UNNAMED_STEP = "Earlier page";

/**
 * The steps along one way of the history as its button's menu lists them:
 * the nearest first, a page's steps gathered together between rules, each
 * named as the window called it there, with what it showed under it.
 */
function historyGroups(
  steps: readonly HistoryStep[],
  onGoTo: (at: number) => void,
): (readonly MenuAction[])[] {
  const groups: MenuAction[][] = [];
  let page: HistoryPage | undefined;
  for (const step of steps) {
    const item: MenuAction = {
      // Note that a step is keyed by its place on the trail, because two steps of one page may be called alike, as a task's Plan and Code are.
      key: step.at,
      label: step.title?.label ?? UNNAMED_STEP,
      detail: step.title?.detail,
      replayMasked: true,
      onSelect: () => onGoTo(step.at),
    };
    if (page !== undefined && sameHistoryPage(step.page, page)) groups.at(-1)?.push(item);
    else groups.push([item]);
    page = step.page;
  }
  return groups;
}

/**
 * Back or Forward: a press takes one step, and a press held (`HoldPress`),
 * a right-click, or the menu key (⇧F10 too) lists the steps along that way, any
 * of which it goes straight to, as a browser's Back and Forward do.
 */
function HistoryButton({
  label,
  command,
  icon,
  able,
  onPress,
  steps,
  onGoTo,
}: {
  label: string;
  command: typeof APP_COMMAND.BACK | typeof APP_COMMAND.FORWARD;
  icon: React.JSX.Element;
  able: boolean;
  onPress: () => void;
  steps: readonly HistoryStep[];
  onGoTo: (at: number) => void;
}): React.JSX.Element {
  const menu = useMenu(able);
  const button = useRef<HTMLButtonElement>(null);
  const openList = () => {
    const element = button.current;
    if (element !== null && steps.length > 0) menu.show(dropBelowStart(element), element);
  };
  return (
    // A press held, the mouse's as a touch's, opens the list, as a browser's Back does, and so
    // does a right-click, which opens no list a hold already opened.
    <HoldPress
      mouse
      disabled={!able}
      onHold={openList}
      onKeyDown={(event) => {
        // Note that the list hangs from the button, not from the wrapper this key bubbles to, because the wrapper lays nothing out.
        if (!able || !opensMenu(event)) return;
        event.preventDefault();
        openList();
      }}
      onContextMenu={() => {
        if (menu.open === undefined) openList();
      }}
    >
      <Tooltip label={label} command={command}>
        <IconButton
          ref={button}
          icon={icon}
          label={label}
          disabled={!able}
          aria-haspopup="menu"
          aria-expanded={menu.open !== undefined}
          onClick={onPress}
        />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${label} history`}
          replayUnmasked
          menu={menu.drawn}
          groups={historyGroups(steps, onGoTo)}
          onClose={menu.close}
        />
      )}
    </HoldPress>
  );
}

/** What every row of the tasks is drawn with, whichever section it stands in. */
interface RowContext {
  readonly tasks: TasksControl;
  /** Whether a task is the one open, which a fold still leaves standing. */
  readonly current: (taskId: string) => boolean;
  /** Whether a row is the one the sidebar marks: the pin the open task was opened from, else the open task's own row. */
  readonly marked: (taskId: string, pin: SidebarPin | undefined) => boolean;
  /** Whether a pin is the one the open place was opened from, which the sidebar marks in its holder's place. */
  readonly markedPin: (pin: SidebarPin) => boolean;
  readonly onOpen: (taskId: string) => void;
  /** Whether a row is the one standing: the open plan's, or the agent's whose page stands. */
  readonly currentRow: (row: TaskRow) => boolean;
  /** Opens an agent with no plan on its own page. */
  readonly onOpenAgent: (agentId: string) => void;
  /** What an agent's delete runs once it landed: its page left where it is the one standing. */
  readonly onDeletedAgent: (agentId: string) => () => void;
  /** Whether a task was saved since the developer last looked at it on this Mac. */
  readonly unread: (task: TaskSummary) => boolean;
  /** Whether an agent's turn ended while the developer was not looking at it. */
  readonly unseenAgent: (agentId: string) => boolean;
  /** The time each row's last update is counted back from. */
  readonly now: number;
  /** Which faces a task's row may wear: no assignee's while the list holds those assigned to one member. */
  readonly faces: RowFaces;
  /** Whether the sidebar is in sight: folded away, nothing it opened stands over the window. */
  readonly inSight: boolean;
  /** Hears a row let go over a section, Tasks, or Pinned, while the account keeps sections; none while it does not. */
  readonly dropOut: ((row: TaskRow, zone: string, at: number) => void) | undefined;
  /** Hears a row lifted into a drag and that drag ended, while which an empty Pinned stands to take it. */
  readonly onCarried: (carried: boolean) => void;
  /** An agent's Move to section, as a task's menu offers it; none for an archived agent. */
  readonly sectionEntry: (agent: TasklessAgent) => MenuEntry | undefined;
  /** How many of a task's child tasks are finished, of all of them, which its row says; none for a task with none. */
  readonly childCount: (taskId: string) => ChildTaskCount | undefined;
  /** Whether a task's child tasks stand open under its row, folded until first opened. */
  readonly opened: (taskId: string) => boolean;
  /** Opens a task's child tasks under its row where they stand folded, and folds them where they stand open. */
  readonly onFoldTask: (taskId: string) => void;
  /** Where the column's runs of rows stand (`SidebarRun`). */
  readonly runs: SidebarRunsPlace;
}

/** The rows a list draws, child tasks nested under their parents and passed by under a fold, the open row still standing (`drawnTaskRows`). */
function nestedRows(
  rows: readonly TaskRow[],
  folds: FoldedGroups,
  current: (row: TaskRow) => boolean,
): TaskRow[] {
  return drawnTaskRows(rows, folds.taskOpened, current).map(({ row }) => row);
}

/** A repository's group's key, by which it leaves the list. */
function repositoryGroupKey(group: RepositoryGroup): string {
  return group.repository ?? NO_REPOSITORY;
}

/** The view's groups, each drawn on after its last row took it out of the list until its exit has played (`ListMotion`). */
function LeavingGroups<G>({
  groups,
  keyOf,
  group,
}: {
  groups: readonly G[];
  keyOf: (group: G) => string;
  group: (group: G) => React.ReactNode;
}): React.JSX.Element {
  const drawn = useLeaving(groups, keyOf);
  return <>{drawn.map(({ value }) => group(value))}</>;
}

/**
 * One group's rows, each a plan's or an agent's with no plan, showing the
 * time the list's order chooses. A row says what its group does not: its
 * repository's name where `repository` names one, and the faces `faces`
 * lets it wear (`rowFaceOf`).
 * A task's child tasks among the rows stand nested under it, folded until
 * its chevron opens them, to any depth, the sidebar having moved each into
 * the list holding its parent (`homedTaskRows`); under a fold, the open
 * one stands at the top (`drawnTaskRows`).
 */
function TaskRows({
  rows,
  context,
  repository,
}: {
  rows: readonly TaskRow[];
  context: RowContext;
  repository?: (row: TaskRow) => React.ReactNode;
}): React.JSX.Element {
  const { faces } = context;
  // Note that the rows keep the view's order, so a row is dragged only out of them, into a section or Pinned.
  const { dropOut } = context;
  const nested = useNestedRows(rows, context.opened, context.currentRow);
  const drawn = useLeaving(nested, ({ row }) => taskRowKey(row));
  const keys = useMemo(() => drawn.map(({ key }) => key), [drawn]);
  const drag = useRunRowDrag(undefined, {
    onDropOut:
      dropOut === undefined
        ? undefined
        : (from, zone, at) => {
            const held = drawn[from]?.value;
            if (held !== undefined) dropOut(held.row, zone, at);
          },
    onCarried: context.onCarried,
  });
  const nests = nestsOf(drawn.map(({ value }) => value));
  return (
    <SidebarRun place={context.runs} keys={keys} onPointerDown={drag}>
      {(index, place) => {
        const entry = drawn[index];
        if (entry === undefined) return null;
        const held = entry.value;
        const { row } = held;
        const nest = nests[index];
        return row.kind === TASK_ROW.TASK ? (
          <SidebarTask
            key={row.task.id}
            tasks={context.tasks}
            task={row.task}
            current={context.marked(row.task.id, undefined)}
            open={context.current(row.task.id)}
            unread={context.unread(row.task)}
            now={context.now}
            at={taskRowTime(row)}
            repository={repository?.(row)}
            faces={faces}
            depth={held.depth}
            nest={nest}
            place={place}
            fold={childTasksFold(held, context.onFoldTask)}
            childCount={context.childCount(row.task.id)}
            onOpen={() => context.onOpen(row.task.id)}
          />
        ) : (
          <SidebarAgent
            key={row.agent.id}
            agent={row.agent}
            agents={context.tasks.agents}
            current={context.currentRow(row)}
            now={context.now}
            at={taskRowTime(row)}
            repository={repository?.(row)}
            face={faces.creator && faces.assignee}
            nest={nest}
            place={place}
            shown={context.tasks.shown && context.inSight}
            onOpen={() => context.onOpenAgent(row.agent.id)}
            onPin={pinOf(context.tasks, row.agent)}
            section={context.sectionEntry(row.agent)}
            onDeleted={context.onDeletedAgent(row.agent.id)}
          />
        );
      }}
    </SidebarRun>
  );
}

/** Pin or Unpin for an agent's row, the account's own; none for an archived agent, which the sidebar draws among the archived whether or not it is pinned, as a plan's. */
function pinOf(tasks: TasksControl, agent: TasklessAgent): ((pinned: boolean) => void) | undefined {
  return agent.archivedAt === undefined
    ? (pinned) => tasks.onPinAgent(agent.id, pinned)
    : undefined;
}

/**
 * One row under Pinned and where its pin stands: a pinned plan, a tab
 * pinned on a listed plan, or an agent pinned on it, drawn as its tab; or a
 * pinned agent with no plan, or a tab pinned on its own page.
 */
type PinnedRow =
  | {
      readonly kind: typeof TASK_ROW.TASK;
      readonly task: TaskSummary;
      readonly pin: SidebarPin | undefined;
      readonly place: PinPlace;
    }
  | {
      readonly kind: typeof TASK_ROW.AGENT;
      readonly agent: TasklessAgent;
      readonly pin: PinnedTab | undefined;
      readonly place: PinPlace;
    };

/** A row under Pinned's key: its plan's or its agent's id, an agent's drawn as its tab included, or where a pinned tab's pin stands. */
function pinnedRowKey(row: PinnedRow): string {
  const { pin } = row;
  if (pin === undefined) return row.kind === TASK_ROW.AGENT ? row.agent.id : row.task.id;
  return isAgentPin(pin) ? pin.tab.agent : String(pin.at);
}

/** The tab a row's pin keeps on this Mac; none for a plan's or an agent's, which the account keeps. */
function localPinOf(row: PinnedRow): PinnedTab | undefined {
  const { pin } = row;
  return pin === undefined || isAgentPin(pin) ? undefined : pin;
}

/** The plan or agent a row's pin is on the account; none for a tab's, which this Mac keeps. */
function accountPinOf(
  row: PinnedRow,
): { readonly agent: boolean; readonly id: string } | undefined {
  const { pin } = row;
  if (pin === undefined) {
    return row.kind === TASK_ROW.AGENT
      ? { agent: true, id: row.agent.id }
      : { agent: false, id: row.task.id };
  }
  return isAgentPin(pin) ? { agent: true, id: pin.tab.agent } : undefined;
}

/** An agent on a plan the account pinned as its row under Pinned draws it: as its tab in the plan's column, named as the agent is. */
function agentPinOf(pin: TaskAgentPin, agent: AgentSummary, tasks: TasksControl): AgentPin {
  const drawn = {
    task: pin.taskId,
    tab: agentTab(agent.id),
    label: agentName(agent, tasks.agents.models),
    at: pin.pinnedAt,
    model: agent.model,
  };
  return pin.pinPosition === undefined ? drawn : { ...drawn, position: pin.pinPosition };
}

/** Where a row's pin stands, which `pin-order.ts` orders the section by. */
const placeOf = (row: PinnedRow): PinPlace => row.place;

/**
 * The rows under Pinned in the order the developer dragged them to, a pin
 * not yet dragged on top, newest pinned first (`pin-order.ts`): the pinned
 * plans, the pinned agents among them, on a plan the list holds or with
 * none, and the tabs pinned to the sidebar on plans and agents the list
 * holds. A tab or an agent of an archived or deleted plan is drawn nowhere,
 * its plan being out of the list; nor is a Plan tab an earlier version
 * pinned, which is made its plan's own pin as soon as the list names the
 * plan (`use-tasks-tab.ts`).
 */
function pinnedRows(
  pinned: readonly TaskSummary[],
  agents: readonly TasklessAgent[],
  standing: readonly TasklessAgent[],
  tasks: TasksControl,
): PinnedRow[] {
  const taskRows = pinned.map(
    (task): PinnedRow => ({
      kind: TASK_ROW.TASK,
      task,
      pin: undefined,
      place: { position: task.pinPosition, at: task.pinnedAt ?? 0 },
    }),
  );
  const agentRows = agents.map(
    (agent): PinnedRow => ({
      kind: TASK_ROW.AGENT,
      agent,
      pin: undefined,
      place: { position: agent.pinPosition, at: agent.pinnedAt ?? 0 },
    }),
  );
  const taskAgentRows = tasks.taskAgentPins.flatMap((pin): PinnedRow[] => {
    const task = tasks.listed.tasks.find((each) => each.id === pin.taskId);
    const agent = tasks.liveAgents?.find((each) => each.id === pin.agentId);
    if (task === undefined || agent === undefined) return [];
    const drawn = agentPinOf(pin, agent, tasks);
    return [
      { kind: TASK_ROW.TASK, task, pin: drawn, place: { position: drawn.position, at: drawn.at } },
    ];
  });
  const tabRows = tasks.sidePanel.pins.flatMap((pin): PinnedRow[] => {
    const place = { position: pin.position, at: pin.at };
    if ("agent" in pin) {
      const agent = standing.find((each) => each.id === pin.agent);
      return agent === undefined ? [] : [{ kind: TASK_ROW.AGENT, agent, pin, place }];
    }
    const task = tasks.listed.tasks.find((each) => each.id === pin.task);
    return task === undefined || pin.tab === SIDE_PANEL_TAB.DESCRIPTION
      ? []
      : [{ kind: TASK_ROW.TASK, task, pin, place }];
  });
  return inPinOrder([...taskRows, ...agentRows, ...taskAgentRows, ...tabRows], placeOf);
}

/**
 * Gives each pin under Pinned the place a drop gave it, a plan's and an
 * agent's on the account and a tab's on this Mac, so the section draws the
 * new order at once. A drop the service refuses any of puts the tabs'
 * places back too, so the section is left in no order of its own making.
 */
function placePins(positions: ReadonlyMap<PinnedRow, string>, tasks: TasksControl): void {
  const tabs = new Map<number, string>();
  const before = new Map<number, string | undefined>();
  const moves = [...positions].flatMap(([row, position]) => {
    const local = localPinOf(row);
    if (local !== undefined) {
      tabs.set(local.at, position);
      before.set(local.at, local.position);
      return [];
    }
    const account = accountPinOf(row);
    return account === undefined ? [] : [{ ...account, position }];
  });
  if (tabs.size > 0) tasks.sidePanel.onPlacePins(tabs);
  tasks.onMovePins(moves, () => tasks.sidePanel.onPlacePins(before));
}

/** Stands the row at `from` under Pinned at `to`. */
function movePinned(
  rows: readonly PinnedRow[],
  from: number,
  to: number,
  tasks: TasksControl,
): void {
  placePins(pinPositionsForMove(rows, from, to, placeOf), tasks);
}

/**
 * Pins a plan's or an agent's row carried into Pinned at `at` among the
 * rows it draws: pinned now, and given a place there, as its neighbors are
 * where they need one, wherever it lands, on top included
 * (`pinPositionsForInsert`).
 */
function pinAt(rows: readonly PinnedRow[], row: TaskRow, at: number, tasks: TasksControl): void {
  const place: PinPlace = { at: Date.now() };
  const moving: PinnedRow =
    row.kind === TASK_ROW.AGENT
      ? { kind: TASK_ROW.AGENT, agent: row.agent, pin: undefined, place }
      : { kind: TASK_ROW.TASK, task: row.task, pin: undefined, place };
  if (row.kind === TASK_ROW.AGENT) tasks.onPinAgent(row.agent.id, true);
  else tasks.onMarkTask(row.task.id, TASK_MARK.PIN);
  placePins(pinPositionsForInsert(rows, moving, at, placeOf), tasks);
}

/** Takes a row out of Pinned: a plan's or an agent's pin on the account, a tab's on this Mac. */
function unpin(row: PinnedRow, tasks: TasksControl): void {
  const local = localPinOf(row);
  if (local !== undefined) {
    tasks.sidePanel.onUnpin(local, local.tab);
    return;
  }
  const account = accountPinOf(row);
  if (account?.agent === true) tasks.onPinAgent(account.id, false);
  else if (account !== undefined) tasks.onMarkTask(account.id, TASK_MARK.UNPIN);
}

/** The write that takes a task or an agent out of the section it is kept in, a pinned one's included; none where it is in none. */
function leaveSection(tasks: TasksControl, member: SectionMember): TaskSectionWrite[] {
  return memberSection(tasks.taskSections, member) === undefined ? [] : unplaceAllWrites([member]);
}

/** The rows Pinned holds of its own, which child tasks stand under: its plans and its agents with no plan, a pinned tab, or an agent drawn as one, being its holder's. */
function pinnedHeld(rows: readonly PinnedRow[]): TaskRow[] {
  return rows.flatMap((row): TaskRow[] => {
    if (row.pin !== undefined) return [];
    return [row.kind === TASK_ROW.AGENT ? agentRow(row.agent) : taskRow(row.task)];
  });
}

/** One row Pinned draws: a pin, with how its child tasks stand under it where it is a task's own, or a child task nested under one. */
type PinnedDrawn =
  | { readonly pin: PinnedRow; readonly held: DrawnTaskRow | undefined }
  | { readonly pin: undefined; readonly held: DrawnTaskRow };

/** A row Pinned draws's key: its pin's, or its child task's id. */
function pinnedDrawnKey(drawn: PinnedDrawn): string {
  return drawn.pin === undefined ? taskRowKey(drawn.held.row) : pinnedRowKey(drawn.pin);
}

/** How deep a row Pinned draws stands: a pin at the top, a child task under it. */
const depthOf = (drawn: PinnedDrawn) => ({ depth: drawn.held?.depth ?? 0 });

/**
 * The rows Pinned draws, in its order: each pin, a pinned task's own
 * followed by the child tasks the sidebar stands under it (`adopted`,
 * `homedTaskRows`), nested and folded as any list's (`drawnTaskRows`); and
 * after them any of those whose parent `rows` leaves out, as a fold does.
 */
function pinnedDrawn(
  rows: readonly PinnedRow[],
  adopted: readonly TaskRow[],
  opened: (taskId: string) => boolean,
  standing: (row: TaskRow) => boolean,
): PinnedDrawn[] {
  const tops = new Map<TaskRow, PinnedRow>();
  for (const pin of rows) {
    if (pin.kind === TASK_ROW.TASK && pin.pin === undefined) tops.set(taskRow(pin.task), pin);
  }
  const under = new Map<PinnedRow, PinnedDrawn[]>();
  const strays: PinnedDrawn[] = [];
  let into = strays;
  for (const held of drawnTaskRows([...tops.keys(), ...adopted], opened, standing)) {
    const pin = held.depth === 0 ? tops.get(held.row) : undefined;
    if (pin !== undefined) {
      into = [{ pin, held }];
      under.set(pin, into);
    } else {
      if (held.depth === 0) into = strays;
      into.push({ pin: undefined, held });
    }
  }
  return [...rows.flatMap((pin) => under.get(pin) ?? [{ pin, held: undefined }]), ...strays];
}

/** The pin a row carried into Pinned lands before, let go at the drawn slot `at`: the count of pins drawn above it. */
function pinSlot(drawn: readonly PinnedDrawn[], at: number): number {
  return drawn.slice(0, at).filter((each) => each.pin !== undefined).length;
}

/** The rows of the list walked by ⌥↑ and ⌥↓ that Pinned holds: its plans, their child tasks, and its agents with no plan, a pinned tab, or an agent drawn as one, being its holder's. */
function pinnedTaskRows(drawn: readonly PinnedDrawn[]): TaskRow[] {
  return drawn.flatMap(({ pin, held }): TaskRow[] => {
    if (pin === undefined) return [held.row];
    if (pin.pin !== undefined) return [];
    return [pin.kind === TASK_ROW.AGENT ? agentRow(pin.agent) : taskRow(pin.task)];
  });
}

/**
 * The Pinned section's rows, each a plan's, an agent's, or a tab's, a
 * plan's child tasks nested under it. A tab's row is keyed by when it was
 * pinned, which no other pin shares, and a plan's or an agent's by its id.
 * A pin moves among the pins, its child tasks with it, and a child task
 * keeps its place under its parent.
 */
function PinnedRows({
  rows,
  drawn: listed,
  context,
  onOpenTab,
  movable,
  onDropOut,
}: {
  rows: readonly PinnedRow[];
  /** The rows drawn, the pins among them and the child tasks nested under them (`pinnedDrawn`). */
  drawn: readonly PinnedDrawn[];
  context: RowContext;
  onOpenTab: (pin: SidebarPin) => void;
  /** Whether a row is dragged to another place among them, which a fold drawing only some of them forbids. */
  movable: boolean;
  /** Hears a row let go over a section or Tasks, while the account keeps sections; none while it does not. */
  onDropOut: ((row: PinnedRow, zone: string, at: number) => void) | undefined;
}): React.JSX.Element {
  const movePin = movable
    ? (from: number, to: number) => movePinned(rows, from, to, context.tasks)
    : undefined;
  const drawn = useLeaving(listed, pinnedDrawnKey);
  const keys = useMemo(() => drawn.map(({ key }) => key), [drawn]);
  // Note that a row is heard by its place among the rows drawn, child tasks and rows on their way out among them, and found among those listed by its key, as the slot it is carried to is (`listedSlot`).
  const listedAt = new Map(listed.map((each, at) => [pinnedDrawnKey(each), at]));
  const fromListed = (from: number) => {
    const key = drawn[from]?.key;
    return key === undefined ? undefined : listedAt.get(key);
  };
  // Note that a drag counts the rows drawn, child tasks among them, so a pin lands beside the pin it was let go among.
  const depths = listed.map(depthOf);
  const move =
    movePin === undefined
      ? undefined
      : (from: number, to: number) => {
          const at = fromListed(from);
          const beside =
            at === undefined ? undefined : movedBeside(depths, at, listedSlot(drawn, from, to));
          const moved = at === undefined ? undefined : listed[at]?.pin;
          const by = beside === undefined ? undefined : listed[beside]?.pin;
          if (moved !== undefined && by !== undefined) {
            movePin(rows.indexOf(moved), rows.indexOf(by));
          }
        };
  const drag = useRunRowDrag(move, {
    onDropOut:
      onDropOut === undefined
        ? undefined
        : (from, zone, at) => {
            const row = drawn[from]?.value.pin;
            if (row !== undefined) onDropOut(row, zone, at);
          },
  });
  const moveKeys = useRowMoveKeys(move);
  // Note that a row on its way out has no place among the rows a drag or a menu moves.
  const pinPlaces = new Map(rows.map((row, at) => [pinnedRowKey(row), at]));
  const placeOf = (key: string) => {
    const at = pinPlaces.get(key);
    return movePin === undefined || at === undefined
      ? undefined
      : { at, count: rows.length, onMove: movePin };
  };
  const nests = nestsOf(drawn.map(({ value }) => depthOf(value)));
  return (
    // An open Pinned keeps an order a row carried in lands at a place in; a folded one draws only some of its rows, so a drop lands on top.
    <SidebarRun
      place={context.runs}
      keys={keys}
      drops={onDropOut !== undefined && movable}
      onPointerDown={drag}
      block={moveKeys}
    >
      {(index, place) => {
        const entry = drawn[index];
        if (entry === undefined) return null;
        const {
          key,
          value: { pin: row, held },
        } = entry;
        const nest = nests[index];
        if (row === undefined) {
          const child = held.row;
          return child.kind === TASK_ROW.TASK ? (
            <SidebarTask
              key={key}
              tasks={context.tasks}
              task={child.task}
              current={context.marked(child.task.id, undefined)}
              open={context.current(child.task.id)}
              unread={context.unread(child.task)}
              now={context.now}
              depth={held.depth}
              nest={nest}
              place={place}
              fold={childTasksFold(held, context.onFoldTask)}
              childCount={context.childCount(child.task.id)}
              onOpen={() => context.onOpen(child.task.id)}
            />
          ) : null;
        }
        if (row.kind === TASK_ROW.AGENT && row.pin !== undefined) {
          const { agent, pin } = row;
          return (
            <RowPlaced key={key} place={placeOf(key)}>
              <SidebarPinnedTab
                tasks={context.tasks}
                pin={pin}
                on={{ agent }}
                nest={nest}
                place={place}
                current={context.markedPin(pin)}
                inSight={context.inSight}
                onOpen={() => onOpenTab(pin)}
                onOpenHolder={() => context.onOpenAgent(agent.id)}
                onUnpin={() => unpin(row, context.tasks)}
              />
            </RowPlaced>
          );
        }
        if (row.kind === TASK_ROW.AGENT) {
          const { agent } = row;
          return (
            <RowPlaced key={key} place={placeOf(key)}>
              <SidebarAgent
                agent={agent}
                agents={context.tasks.agents}
                current={context.currentRow(agentRow(agent))}
                now={context.now}
                at={agent.activityAt}
                nest={nest}
                place={place}
                shown={context.tasks.shown && context.inSight}
                onOpen={() => context.onOpenAgent(agent.id)}
                onPin={pinOf(context.tasks, agent)}
                section={context.sectionEntry(agent)}
                onDeleted={context.onDeletedAgent(agent.id)}
              />
            </RowPlaced>
          );
        }
        const { task, pin } = row;
        return (
          <RowPlaced key={key} place={placeOf(key)}>
            {pin === undefined ? (
              <SidebarTask
                tasks={context.tasks}
                task={task}
                current={context.marked(task.id, undefined)}
                open={context.current(task.id)}
                unread={context.unread(task)}
                now={context.now}
                nest={nest}
                place={place}
                fold={held === undefined ? undefined : childTasksFold(held, context.onFoldTask)}
                childCount={context.childCount(task.id)}
                onOpen={() => context.onOpen(task.id)}
              />
            ) : (
              <SidebarPinnedTab
                tasks={context.tasks}
                pin={pin}
                on={{ task }}
                nest={nest}
                place={place}
                current={context.marked(task.id, pin)}
                inSight={context.inSight}
                onOpen={() => onOpenTab(pin)}
                onOpenHolder={() => context.onOpen(task.id)}
                onUnpin={() => unpin(row, context.tasks)}
              />
            )}
          </RowPlaced>
        );
      }}
    </SidebarRun>
  );
}

/**
 * The Pinned section, a section of its own above Tasks rather than a group
 * among them, so whatever the list's view groups by or filters, the pins
 * stand as they were pinned. Its head folds it, and folded counts its pins.
 * The fold is kept across launches as a repository's is, and folded, the
 * open plan, or the pinned tab on show, still stands under it, as under a
 * repository's fold. While the account keeps sections it is a drop zone as
 * a section is: a row carried in from Tasks or a section is pinned where it
 * is let go, and one carried out is unpinned. It stands only while something
 * is pinned, or, while nothing is, as the place a carried row drops in: its
 * heading over an empty slot, with no fold and no count, since there is
 * nothing to fold or count, and no words of its own, since the heading
 * names what letting go there does and the row in hand is what it does it
 * to. A row's hover Pin and its ⋯ menu still make the first pin. A pinned
 * plan's child tasks stand under it, folded until it opens them, as in any
 * list, and are not counted as pins.
 */
function PinnedSection({
  rows,
  adopted,
  folds,
  shown,
  context,
  onOpenTab,
  onDropOut,
  carried,
}: {
  rows: readonly PinnedRow[];
  /** The child tasks standing under its plans (`homedTaskRows`). */
  adopted: readonly TaskRow[];
  folds: FoldedGroups;
  /** Whether a row is the plan open, the agent whose page stands, or the pinned tab on show, which a fold leaves standing. */
  shown: (row: PinnedRow) => boolean;
  context: RowContext;
  onOpenTab: (pin: SidebarPin) => void;
  /** Hears a row let go over a section or Tasks, while the account keeps sections, which makes Pinned a drop zone too; none while it does not. */
  onDropOut: ((row: PinnedRow, zone: string, at: number) => void) | undefined;
  /** Whether a row is carried, which an empty Pinned stands for, as the slot it lands in. */
  carried: boolean;
}): React.JSX.Element {
  const folded = folds.pinnedFolded;
  const { taskOpened } = folds;
  const drawn = pinnedDrawn(rows, adopted, taskOpened, context.currentRow);
  const standing = pinnedDrawn(
    rows.filter(shown),
    adopted.filter(context.currentRow),
    taskOpened,
    context.currentRow,
  );
  const empty = rows.length === 0;
  return (
    <nav
      className="sidebar-group"
      aria-label="Pinned"
      data-row-drop={onDropOut === undefined ? undefined : PINNED_DROP_ZONE}
      {...motionKey(PINNED_KEY)}
    >
      <GroupHeader
        heading={GROUP_HEADING.NONE}
        label="Pinned"
        fold={empty ? undefined : sidebarFold(folded, folds.togglePinned)}
        count={
          empty ? undefined : foldedCount(folded, rows.length, PIN_NOUN, NAV_COUNT_SHOWN.ALWAYS)
        }
        standing={
          standing.length === 0 ? undefined : (
            <PinnedRows
              rows={rows.filter(shown)}
              drawn={standing}
              context={context}
              onOpenTab={onOpenTab}
              movable={false}
              onDropOut={onDropOut}
            />
          )
        }
      >
        {empty ? (
          carried && <DropSlot />
        ) : (
          <PinnedRows
            rows={rows}
            drawn={drawn}
            context={context}
            onOpenTab={onOpenTab}
            movable
            onDropOut={onDropOut}
          />
        )}
      </GroupHeader>
    </nav>
  );
}

/**
 * A repository's actions, offered alike from its header's ⋯ and from a
 * right-click on the header, in one group: Pin holds the group above the
 * rest on the account, and Open on GitHub opens the repository's page, under
 * GitHub's mark rather than the owner's picture, since it is about GitHub.
 * Note that a status for every task under the header at once is the
 * selection bar's, not the header's. The tasks with no repository have no
 * pin, since they always stand last, and no page to open, so they offer no
 * menu.
 */
function repositoryActionGroups(group: RepositoryGroup, tasks: TasksControl): MenuEntry[][] {
  const { repository } = group;
  if (repository === null) return [];
  const pin: MenuAction = tasks.pinnedRepositories.includes(repository)
    ? {
        label: "Unpin",
        icon: <UnpinIcon />,
        onSelect: () => tasks.onPinRepository(repository, false),
      }
    : { label: "Pin", icon: <PinIcon />, onSelect: () => tasks.onPinRepository(repository, true) };
  const github: MenuAction = {
    label: "Open on GitHub",
    icon: <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />,
    onSelect: () => tasks.repositories.openGitHub(repositoryPageUrl(repository)),
  };
  return [[pin, github]];
}

/** Pinned holds tabs as well as tasks, so its count is read as pins. */
const PIN_NOUN: CountNoun = { one: "pin", many: "pins" };

/** Pinned's key, by which it leaves the column once it stands for nothing. */
const PINNED_KEY = "pinned";

/** Pinned listed, or not, for `LeavingGroups`: constants, so a render that changes neither lists nothing new. */
const PINNED_LISTED: readonly string[] = [PINNED_KEY];
const NOTHING_LISTED: readonly string[] = [];

/**
 * One repository's tasks under a header in the headings' voice, which folds
 * and unfolds them, the fold kept across launches. The header is a row like
 * a task's, with its hover, led by the owner's picture, which gives way to
 * the fold's chevron while the header is hovered or reached from the
 * keyboard, pointing down while the group is open and right while it is
 * folded, the way Codex and Cursor draw a project. Its actions stand at its end while it is hovered or holds
 * focus: a ⋯ that drops the repository's menu, which a right-click anywhere
 * on the header opens too, and a + that starts a new task with the
 * repository already chosen. Both stand beside the fold rather than inside
 * it, so pressing either folds nothing. Folded, the header counts its tasks
 * at its end while hovered or reached from the keyboard, and the open task
 * still stands under it, so the task being worked on never leaves the list.
 * The tasks with no repository stand under "No repository", with nothing to
 * preset and no page to open.
 */
function RepositorySection({
  group,
  label,
  folds,
  onNewTaskIn,
  context,
}: {
  group: RepositoryGroup;
  /** What the header says for the repository: its name, or `owner/name` where another shares the name. */
  label: string;
  folds: FoldedGroups;
  onNewTaskIn: (repository: string) => void;
  context: RowContext;
}): React.JSX.Element {
  const { repository } = group;
  const folded = folds.folded(repository);
  const named = repository === null ? NO_REPOSITORY : label;
  const standing = group.rows.filter(context.currentRow);
  // The menu is drawn over the window rather than inside the sidebar, so it
  // closes with the sidebar folding away as well as with the tab hiding.
  const menu = useMenu(context.tasks.shown && context.inSight);
  const ellipsis = useRef<HTMLButtonElement | null>(null);
  const actionGroups = repositoryActionGroups(group, context.tasks);
  return (
    <div className="sidebar-repository" {...motionKey(repositoryGroupKey(group))}>
      <GroupHeader
        heading={GROUP_HEADING.NONE}
        glyph={
          repository === null ? (
            <NoRepositoryGlyph />
          ) : (
            <RepositoryPicture
              repository={repository}
              pictures={context.tasks.repositories.pictures}
              size={AVATAR_SIZE.GLYPH}
            />
          )
        }
        label={repository === null ? named : <ReplayMask>{named}</ReplayMask>}
        fold={sidebarFold(folded, () => folds.toggle(repository))}
        count={foldedCount(folded, group.rows.length, TASK_NOUN)}
        mark={
          repository !== null && context.tasks.pinnedRepositories.includes(repository) ? (
            <span className="sidebar-repository-pinned inline-flex flex-none text-muted-foreground [&_svg]:size-ui-12">
              <PinIcon />
              <VisuallyHidden>(pinned)</VisuallyHidden>
            </span>
          ) : null
        }
        tooltip={repository === null || label === repository ? undefined : repository}
        menuOpen={menu.open !== undefined}
        contextMenu={actionGroups.length === 0 ? undefined : menu.contextMenu(ellipsis)}
        standing={
          standing.length === 0 ? undefined : <TaskRows rows={standing} context={context} />
        }
        actions={
          <>
            {actionGroups.length === 0 ? null : (
              <MoreButton
                ref={ellipsis}
                thing={named}
                size={BUTTON_SIZE.COMPACT}
                {...menu.trigger()}
              />
            )}
            {repository === null ? null : (
              <NewTaskInButton
                label={`New task in ${label}`}
                onPress={() => onNewTaskIn(repository)}
              />
            )}
          </>
        }
      >
        {group.rows.length === 0 ? null : <TaskRows rows={group.rows} context={context} />}
      </GroupHeader>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${named} actions`}
          replayUnmasked
          menu={menu.drawn}
          groups={actionGroups}
          onClose={menu.close}
        />
      )}
    </div>
  );
}

/** The listed tasks as the view groups them: by repository, or in one run. */
type TaskSections =
  | {
      readonly grouping: typeof TASK_GROUPING.REPOSITORY;
      readonly groups: readonly RepositoryGroup[];
    }
  | { readonly grouping: typeof TASK_GROUPING.NONE; readonly rows: readonly TaskRow[] };

/**
 * The tasks under Tasks as the view groups them, newest updated first.
 * Grouped by repository, the pinned repositories' groups stand above the
 * rest, newest pinned first, and the rest keep the order's.
 */
function taskSections(
  rows: readonly TaskRow[],
  grouping: TaskSections["grouping"],
  tasks: TasksControl,
): TaskSections {
  if (grouping === TASK_GROUPING.NONE) {
    return { grouping, rows: orderTaskRows(rows) };
  }
  const grouped = repositoryGroups(rows);
  const pinnedAt = (group: RepositoryGroup) =>
    group.repository === null ? -1 : tasks.pinnedRepositories.indexOf(group.repository);
  return {
    grouping,
    groups: [
      ...grouped.filter((group) => pinnedAt(group) >= 0).sort((a, b) => pinnedAt(a) - pinnedAt(b)),
      ...grouped.filter((group) => pinnedAt(group) < 0),
    ],
  };
}

/** The rows the sections draw, in their order: each group's unless folded, the row standing under its fold. */
function drawnTasks(
  sections: TaskSections,
  folds: FoldedGroups,
  current: (row: TaskRow) => boolean,
): TaskRow[] {
  const under = (folded: boolean, rows: readonly TaskRow[]) =>
    nestedRows(folded ? rows.filter(current) : rows, folds, current);
  switch (sections.grouping) {
    case TASK_GROUPING.REPOSITORY:
      return sections.groups.flatMap((group) => under(folds.folded(group.repository), group.rows));
    case TASK_GROUPING.NONE:
      return nestedRows(sections.rows, folds, current);
  }
}

/** The rows of each of the sections' lists: each group's, or the one run's. */
function taskSectionLists(sections: TaskSections): (readonly TaskRow[])[] {
  return sections.grouping === TASK_GROUPING.NONE
    ? [sections.rows]
    : sections.groups.map((group) => group.rows);
}

/** The sections with each list's rows as `lists` hands them, in `taskSectionLists`'s order, a group left with none taken out. */
function withTaskLists(
  sections: TaskSections,
  lists: readonly (readonly TaskRow[])[],
): TaskSections {
  const rowsAt = (at: number) => lists[at] ?? [];
  switch (sections.grouping) {
    case TASK_GROUPING.REPOSITORY:
      return {
        ...sections,
        groups: sections.groups
          .map((group, at) => ({ ...group, rows: rowsAt(at) }))
          .filter((group) => group.rows.length > 0),
      };
    case TASK_GROUPING.NONE:
      return { ...sections, rows: rowsAt(0) };
  }
}

/** A section as it draws `rows` (`homedTaskRows`): the entries of its own rows among them, a child task standing under a parent it holds after them with no entry. */
function homedSection(drawn: ShownSection, rows: readonly TaskRow[]): ShownSection {
  const kept = new Set(rows);
  const entries = drawn.entries.filter((_, at) => {
    const row = drawn.rows[at];
    return row !== undefined && kept.has(row);
  });
  return { ...drawn, entries, rows };
}

/** What decides where the Tasks section stands its rows: the workspace listed, the grouping, and whose tasks it holds. */
interface TaskOrderView {
  readonly workspaceId: string | undefined;
  readonly grouping: TaskSections["grouping"];
  readonly assignedTo: AssignedTo;
}

/** The member Assigned to names, or none for Me and Anyone. */
function assignedMember(assignedTo: AssignedTo): string | undefined {
  return assignedTo.kind === ASSIGNED_TO.MEMBER ? assignedTo.userId : undefined;
}

/** Whether the Tasks section drawn under one view stands its rows as it would under another. */
function sameTaskOrder(was: TaskOrderView, now: TaskOrderView): boolean {
  return (
    was.workspaceId === now.workspaceId &&
    was.grouping === now.grouping &&
    was.assignedTo.kind === now.assignedTo.kind &&
    assignedMember(was.assignedTo) === assignedMember(now.assignedTo)
  );
}

/** The sections with each row drawn as it is now, wherever its held place stood it. */
function liveSections(sections: TaskSections, live: ReadonlyMap<string, TaskRow>): TaskSections {
  const now = (rows: readonly TaskRow[]) => rows.map((row) => live.get(taskRowKey(row)) ?? row);
  switch (sections.grouping) {
    case TASK_GROUPING.REPOSITORY:
      return {
        ...sections,
        groups: sections.groups.map((group) => ({ ...group, rows: now(group.rows) })),
      };
    case TASK_GROUPING.NONE:
      return { ...sections, rows: now(sections.rows) };
  }
}

/** The group a row stands in under a grouping, by what keys it: its repository, or the one run's. */
function groupOf(row: TaskRow, grouping: TaskSections["grouping"]): string | null | undefined {
  switch (grouping) {
    case TASK_GROUPING.REPOSITORY:
      return taskRowRepository(row);
    case TASK_GROUPING.NONE:
      return null;
  }
}

/**
 * Where each row stands, as the sections order and group it: the row as it
 * was first drawn while the pointer is over the sidebar (`use-held-order.ts`), or as
 * it is now where it is new to the list, it belongs in another group now, or
 * a press here gave it a name or a status the view has yet to carry. Note
 * that a row held under a group it left would stand under a header that no
 * longer names it, so it moves to its own at once, as the reader's own act
 * does.
 */
function taskPlaces(
  rows: readonly TaskRow[],
  held: ReadonlyMap<string, TaskRow>,
  view: Pick<TaskOrderView, "grouping"> & { readonly pending: ReadonlySet<string> | undefined },
): ReadonlyMap<string, TaskRow> {
  const placeOf = (row: TaskRow) => {
    const was = held.get(taskRowKey(row));
    const pending = row.kind === TASK_ROW.TASK && view.pending?.has(row.task.id) === true;
    return was === undefined ||
      pending ||
      groupOf(was, view.grouping) !== groupOf(row, view.grouping)
      ? row
      : was;
  };
  return new Map(rows.map((row) => [taskRowKey(row), placeOf(row)] as const));
}

/**
 * The Tasks section's groups as the view draws them. A row says what its
 * group does not: under a repository's header a teammate's face; in one run
 * its repository and the face. Under a creator's header it says neither,
 * its repository left to its card.
 */
function TaskGroups({
  sections,
  repositoryOf,
  folds,
  onNewTaskIn,
  context,
}: {
  sections: TaskSections;
  repositoryOf: (row: TaskRow) => React.ReactNode;
  folds: FoldedGroups;
  onNewTaskIn: (repository: string) => void;
  context: RowContext;
}): React.JSX.Element | null {
  switch (sections.grouping) {
    case TASK_GROUPING.REPOSITORY:
      return (
        <LeavingGroups
          key={sections.grouping}
          groups={sections.groups}
          keyOf={repositoryGroupKey}
          group={(group) => (
            <RepositorySection
              key={repositoryGroupKey(group)}
              group={group}
              label={
                group.repository === null
                  ? NO_REPOSITORY
                  : repositoryLabel(group.repository, sections.groups)
              }
              folds={folds}
              onNewTaskIn={onNewTaskIn}
              context={context}
            />
          )}
        />
      );
    case TASK_GROUPING.NONE:
      return sections.rows.length === 0 ? null : (
        <TaskRows rows={sections.rows} context={context} repository={repositoryOf} />
      );
  }
}

/**
 * The tasks while the list is first read: a task row's room and its name's
 * type for each block, one line as a row's name is, so the rows land where
 * the blocks stood. Nothing stands for the repository headers, whose number
 * nobody knows yet.
 */
function ListSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label="Reading your tasks…">
      <div className="sidebar-skeleton">
        {LIST_SKELETON.map((width) => (
          <div key={width} className="sidebar-skeleton-row">
            <Skeleton width={width} />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** What the sidebar is drawn with while it floats, or could. */
interface FloatingSidebar extends HoverPane {
  /** Whether the sidebar is on screen: pinned, or floating over the work. */
  readonly inSight: boolean;
}

/** Where a sidebar opened from away takes the keyboard: the row it marks, else New task, the first of its places. */
function sidebarFocus(sidebar: HTMLElement): HTMLElement | null {
  return (
    sidebar.querySelector<HTMLElement>('[aria-current="page"]') ??
    sidebar.querySelector<HTMLElement>(".sidebar-places > button")
  );
}

/**
 * The floating sidebar's doors (`hover-pane.ts`), the pointer leaving a peek
 * for the toggle standing over its head leaving it out. It goes with the
 * sidebar, so a menu's way to Settings or a version history, or any other
 * way off the plans, leaves it away for their return.
 */
function useFloatingSidebar(sidebar: SidebarCollapse): FloatingSidebar {
  const pane = useHoverPane(
    { state: sidebar.overlay, onState: sidebar.onOverlay },
    { focusAt: sidebarFocus, stays: ".title-bar-controls" },
  );
  return { ...pane, inSight: sidebarInSight(sidebar) };
}

/**
 * Home's row, between Search and the Inbox and drawn as they are: the
 * house, its name, and its chord at its end while the row is hovered or
 * reached from the keyboard. A press goes to Home from wherever the window
 * stands, and the row is the place shown while Home is.
 */
function SidebarHomeRow({
  current,
  disabled,
  onOpen,
}: {
  current: boolean;
  disabled: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <NavItem
      icon={<HouseIcon />}
      current={current ? NAV_CURRENT.PAGE : undefined}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.HOME)}
      shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.HOME].chord} />}
      disabled={disabled}
      onClick={onOpen}
    >
      Home
    </NavItem>
  );
}

/**
 * The Tasks page's row, under the Inbox's. A press opens the listed
 * workspace's tasks as a List or a Board (`tasks-page.tsx`), as its chord
 * does, and the row is the place shown while it stands. It is always offered.
 * The page's chunk is read once the signed-in window is idle, or as the
 * pointer comes onto the row, so the first press finds it landed.
 */
function SidebarTasksRow({
  current,
  disabled,
  onOpen,
  onPreload,
}: {
  current: boolean;
  disabled: boolean;
  onOpen: () => void;
  /** Reads the Board's route ahead of a press, its chunk among it. */
  onPreload: () => void;
}): React.JSX.Element {
  useWhenIdle(() => {
    if (!disabled) onPreload();
  }, IDLE_TIMEOUT_MS.PREFETCH);
  return (
    <NavItem
      icon={<ListTodoIcon />}
      current={current ? NAV_CURRENT.PAGE : undefined}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.TASKS)}
      shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.TASKS].chord} />}
      disabled={disabled}
      onPointerEnter={onPreload}
      onClick={onOpen}
    >
      Tasks
    </NavItem>
  );
}

/**
 * The Automations page's row, after the Tasks page's and drawn as it is: the
 * zap, its name, and its chord. A press opens the window's Automations page
 * (`automations-page.tsx`), and the row is the place shown while it stands.
 * While a run of the account's own automation failed to start since that
 * automation was opened, the row wears the failed mark at its end, where the
 * Inbox's count stands on its row, giving way to the chord as that does.
 * While agents its workspace's automations started still work, it counts
 * them in the working tone beside that mark, as the Runs tab does.
 */
function SidebarAutomationsRow({
  current,
  failed,
  running,
  disabled,
  onOpen,
}: {
  current: boolean;
  failed: boolean;
  /** How many runs of the listed workspace's automations still have an agent at work. */
  running: number;
  disabled: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <NavItem
      icon={<ZapIcon />}
      current={current ? NAV_CURRENT.PAGE : undefined}
      count={{ value: running, noun: RUNNING_NOUN, tone: STATUS_TONE.WORKING }}
      mark={failed ? stateEndMark(GLYPH_STATE.FAILED, false) : undefined}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.AUTOMATIONS)}
      shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.AUTOMATIONS].chord} />}
      disabled={disabled}
      onClick={onOpen}
    >
      Automations
    </NavItem>
  );
}

/**
 * The Admin row, after Automations' and drawn as it is, for an admin alone:
 * a non-admin is drawn nothing, not a row held back. A press opens the
 * window's Admin place (`desktop-admin.tsx`) in the task's place, as
 * Automations' row does, and the row is the place shown while it stands.
 * Note that the row is a convenience: the service's own gate decides every
 * read the place makes.
 */
function SidebarAdminRow({
  current,
  onOpen,
  onPreload,
}: {
  current: boolean;
  onOpen: () => void;
  onPreload: () => void;
}): React.JSX.Element | null {
  const admin = useQuery({ ...appStateQuery, select: selectAdminAccess }).data === true;
  if (!admin) return null;
  return (
    <NavItem
      icon={<ShieldUserIcon />}
      current={current ? NAV_CURRENT.PAGE : undefined}
      // The pointer on the row is the way to the place, so its chunk, charts and all, is read now rather than at the press.
      onPointerEnter={onPreload}
      onClick={onOpen}
    >
      Admin
    </NavItem>
  );
}

/** The listed workspace's sections as the sidebar draws them, and the tasks and agents standing in any of them, which Tasks leaves out. */
interface SectionedTasks {
  readonly sections: readonly DrawnSection[];
  readonly taskIds: ReadonlySet<string>;
  readonly agentIds: ReadonlySet<string>;
}

/**
 * The account's sections in the workspace, each with the tasks of `free`,
 * the listed tasks no pin holds, and the agents of `freeAgents`, the listed
 * agents with no task no pin holds, it keeps, in its order. A row in a
 * section that stands elsewhere, pinned or archived, is no row of it, and
 * comes back to it once it stands free again. None while the account keeps
 * no sections here.
 */
function sectionedTasks(
  tasks: TasksControl,
  workspaceId: string | undefined,
  free: readonly TaskSummary[],
  freeAgents: readonly TasklessAgent[],
): SectionedTasks {
  if (workspaceId === undefined) return { sections: [], taskIds: new Set(), agentIds: new Set() };
  const state = tasks.taskSections;
  const byId = new Map(free.map((task) => [task.id, task]));
  const agentsById = new Map(freeAgents.map((agent) => [agent.id, agent]));
  const sections = workspaceSections(state, workspaceId).map((section): DrawnSection => {
    const held = sectionOrder(state, section.id).flatMap((entry) => {
      const agent = isAgentEntry(entry) ? agentsById.get(entry.agentId) : undefined;
      const task = isAgentEntry(entry) ? undefined : byId.get(entry.taskId);
      if (agent !== undefined) return [{ entry, row: agentRow(agent) }];
      return task === undefined ? [] : [{ entry, row: taskRow(task) }];
    });
    return { section, entries: held.map(({ entry }) => entry), rows: held.map(({ row }) => row) };
  });
  const rows = sections.flatMap((drawn) => drawn.rows);
  const taskIds = new Set(rows.flatMap((row) => (row.kind === TASK_ROW.TASK ? [row.task.id] : [])));
  const agentIds = new Set(
    rows.flatMap((row) => (row.kind === TASK_ROW.AGENT ? [row.agent.id] : [])),
  );
  return { sections, taskIds, agentIds };
}

/**
 * A section as the view leaves it: its tasks to do and in progress, any
 * with no status, an agent's among them, and any parent a child task keeps
 * open, of those Assigned to holds, each with its entry, in its order; and
 * the rest of those it holds counted by status, so the section says what it
 * holds where the view hides it. Note that a row Assigned to leaves out is
 * counted in no status, because Show all, not the Tasks page, brings it back.
 */
function sectionInView(
  drawn: DrawnSection,
  openParents: ReadonlySet<string>,
  assignedTo: AssignedTo,
  readerId: string | undefined,
): ShownSection {
  const people = taskRowsAssignedTo(drawn.rows, assignedTo, readerId);
  const held = new Set(people);
  const shown = (row: TaskRow) =>
    held.has(row) && taskRowInStatuses(row, SHOWN_STATUSES, openParents);
  const kept = drawn.rows.flatMap((row, at) => {
    const entry = drawn.entries[at];
    return entry !== undefined && shown(row) ? [{ entry, row }] : [];
  });
  return {
    ...drawn,
    entries: kept.map(({ entry }) => entry),
    rows: kept.map(({ row }) => row),
    hidden: hiddenStatuses(people, SHOWN_STATUSES, openParents),
    othersHeld: people.length < drawn.rows.length,
  };
}

/** What the sidebar is drawn from. */
interface DesktopSidebarProps {
  sidebar: SidebarCollapse;
  history: NavigationHistory;
  tasks: TasksControl;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  account: AccountSnapshot;
  updates: UpdateControl;
  /** Signs the account out, when the account menu's Sign out is pressed. */
  onSignOut: () => Promise<void>;
  /** Hears every press in the sidebar, which a press outside it would put away while it floats. */
  onPressWithin: () => void;
  /** The room the panel's stage gives; narrow, the sidebar is a phone's drawer. Wide where left out. */
  room?: ShellRoom | undefined;
}

/**
 * New task, heading the list: a press opens the New task dialog at once, as
 * the menu bar's and the chord's New task do, whose name field also
 * searches the workspace's Linear issues where Linear is connected
 * (`new-task-dialog.tsx`); on Home it hands Home's own composer the caret
 * instead (`desktop-home.tsx`). While words left in its card wait as the
 * workspace's draft, it wears the Draft pencil at its end, which its chord
 * takes the place of while it is hovered; none while the card or Home,
 * whose composer shows those words, is open, as a task open wears none.
 */
function NewTaskButton({
  tasks,
  shown,
  onNewTask,
}: {
  tasks: TasksControl;
  /** Whether New task's words are in sight: its card open, or Home shown. */
  shown: boolean;
  onNewTask: () => void;
}): React.JSX.Element {
  const drafted = useNewTaskDrafted(tasks.newTask.workspaceId) && tasks.signedIn && !shown;
  return (
    <NavItem
      icon={<ComposeIcon />}
      mark={drafted ? <DraftMark /> : undefined}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.NEW_TASK)}
      shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.NEW_TASK].chord} />}
      disabled={!tasks.signedIn}
      onClick={onNewTask}
    >
      New task
    </NavItem>
  );
}

/**
 * Times the window's first usable screen: its start to the sidebar's first
 * task list read answered, saying how many tasks the read answered, every
 * workspace's, since the workspace chosen may not stand yet. A window whose
 * first read fails is left untimed rather than timed through the
 * developer's Retry. Note that a window opening signed out is not left,
 * because every window opens so until the account's session is restored.
 */
function useFirstUsableSpan(tasks: TasksControl): void {
  const { listRead, listFailed } = tasks;
  const listed = tasks.tasks.length;
  useEffect(() => {
    if (listFailed) leaveWindowSpan(PANEL_SPAN.WINDOW_FIRST_USABLE);
    else if (listRead)
      endWindowSpan(PANEL_SPAN.WINDOW_FIRST_USABLE, () => ({
        [PANEL_SPAN_ATTRIBUTE.TASK_COUNT]: listed,
      }));
  }, [listRead, listFailed, listed]);
}

/**
 * The window's left column: at its head the workspace chosen, by its tile
 * and name and who shares it, with the menu that chooses another
 * (`workspace-switcher.tsx`), or the app's identity while no workspace is read; the way to
 * a new task, Search, which opens the command palette, every task of the
 * workspace chosen, and the account's
 * row, whose menu and gear lead to Settings and the rest. Home's row, the
 * Inbox's, and the Automations page's follow Search above the rule: Home's
 * goes to Home (`desktop-home.tsx`), the Inbox's counts what waits on the
 * developer and opens the window's Inbox, and the Automations page's opens the window's Automations page. The pinned tasks, and the side panel tabs
 * pinned to the sidebar, stand in the Pinned section while any are pinned,
 * newest pinned first, under a head that folds it, every row one line whose
 * hover card says the rest; whatever the list's view says, they stand as
 * pinned. The rest stand in the Tasks section, grouped and ordered as its
 * View options say and the workspace keeps on this Mac
 * (`task-list-view.ts`): under their repositories' headers by default, the
 * pinned repositories first, newest pinned first, then the group updated
 * most recently first; under their creators'; or in one run. A task
 * archived by an older build, before archiving went, stands nowhere.
 * It is where the developer moves between things; what they work on is the
 * column beside it. On a phone it is the Tasks page (`mobile-bar.tsx`),
 * whose bar already holds New task, Search, the Inbox, and Tasks, and whose
 * phone opens on the Inbox rather than Home, so it leaves those rows to the bar,
 * and heads itself as every phone place does, its workspaces and account
 * behind the reader's face (`phone-account.tsx`) rather than at its head and foot.
 * The open task's row is marked, or, where the task was opened from a pin,
 * that pin's row, while the task stays open.
 * A task's actions are a right-click on it away, whether or not it is open.
 * The strip above the head is the window's drag handle and the traffic lights'
 * room, with back and forward at its right. Its right edge resizes it, and a drag well past its least width
 * folds it away. Folded away, it is inert as well as out of sight, so no key
 * reaches a row nobody can see, until it floats open over the work
 * (`sidebar-collapse.ts`). A floating sidebar is put away by a choice in it,
 * by Escape, by a press outside, or once the pointer leaves a peek, a press
 * in it or not, though not for a menu it raised (`hover-pane.ts`). Opened
 * from away, it takes the keyboard at the row it marks, else at New plan,
 * holds it there against Tab, and Escape gives the keyboard back where it
 * was. Floating, it has no edge to drag, since only a pinned sidebar is
 * resized.
 */
function SidebarColumn({
  sidebar,
  history,
  tasks,
  tab,
  onTabChange,
  account,
  updates,
  onSignOut,
  onPressWithin,
  room = SHELL_ROOM.WIDE,
}: DesktopSidebarProps): React.JSX.Element {
  const connected = useConnected();
  const onTasks = tab === PANEL_TAB.TASKS;
  // Whether a row of the column is lifted into a drag, while which an empty Pinned stands to take it.
  const [carrying, setCarrying] = useState(false);
  // Whether the pointer is over the column, while which its tasks hold their places.
  const [pointing, setPointing] = useState(false);
  const overlay = useFloatingSidebar(sidebar);
  useFirstUsableSpan(tasks);
  const body = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const runs = useVirtualRuns();
  // Note that the runs draw only the rows near the view, and every row while a find bar stands open over the column.
  const finding = useFindOpen();
  const runsPlace = useMemo(
    (): SidebarRunsPlace => ({ scroller, body, finding, holdRun: runs.hold }),
    [finding, runs.hold],
  );
  // The column's rows, the app's, the pins', and every group's tasks and agents, are one Tab stop that ↑↓ walk, a folded group's passed by;
  // a key reaching past the rows drawn goes on to the row it reaches across the runs, in the order they stand, brought in where it is not drawn.
  const roving = useRovingKeys<HTMLDivElement>({
    reach: (from, to) => {
      const box = body.current;
      if (box === null) return false;
      const inHand = from
        ?.closest(`[${VIRTUAL_ROW_KEY_ATTRIBUTE}]`)
        ?.getAttribute(VIRTUAL_ROW_KEY_ATTRIBUTE);
      const key = reachedKey(runs.keys(), inHand ?? undefined, to);
      if (key === undefined) return false;
      const row = box.querySelector(`[${VIRTUAL_ROW_KEY_ATTRIBUTE}="${CSS.escape(key)}"]`);
      const press = row === null ? undefined : rovingItemIn(row);
      if (press !== undefined) {
        press.focus();
        return true;
      }
      return runs.bringIn(key, (drawn) => rovingItemIn(drawn)?.focus());
    },
  });
  const bodyRef = useMemo(() => joinRefs(body, roving.ref), [roving.ref]);
  // The window's Inbox, an agent's or a person's page, the Automations page, the Board, and Admin stand in the task's place, so while one does no task is the place shown.
  // Note that Admin, the Board, a person's page, and the Automations pages stand over the window's state, which stays as it was under them, so no place of that state is shown then.
  const inAdmin = tasks.adminView.open;
  const inInbox = onTasks && !inAdmin && tasks.inboxView.open;
  const inAutomations = onTasks && tasks.automationsView.open;
  const inBoard = onTasks && !inAdmin && tasks.boardView.open;
  const inPerson = onTasks && !inAdmin && tasks.personView.userId !== undefined;
  // Opening an automation sees its failed run, which the Automations row is marked for until then.
  const { place: automationsPlace } = tasks.automationsView;
  // The workspace's runs, followed while the sidebar stands, as the Runs tab follows them, for the row to count the ones still at work.
  const { read: workspaceRuns } = useWorkspaceRuns(
    tasks.signedIn ? tasks.workspace?.id : undefined,
  );
  const automationsRunning = runningRuns(workspaceRuns);
  const automationFailed = useFailedRunsMark(
    tasks.failedRuns,
    tasks.workspace?.id,
    inAutomations && automationsPlace.kind === AUTOMATIONS_PAGE.EDIT
      ? automationsPlace.automationId
      : undefined,
    sidebar.staged,
  );
  const standingIn =
    inInbox ||
    inAutomations ||
    inBoard ||
    inPerson ||
    inAdmin ||
    (onTasks && tasks.agentView.agentId !== undefined);
  const waiting = useInboxWaiting(tasks);
  // A press in the list is always about tasks, so it brings the Tasks tab
  // forward from Settings as well as choosing; a task's row goes back to work
  // on it, on the agent waiting on the developer where one does (`onResume`).
  // A press for a place of the window's state leaves a routed place standing for it, Settings or Admin (`panel-router.tsx`).
  // Note that the leave and the door are one way out, asked once, because a page holding unsaved work holds one question, which a second ask would take the place of.
  const leaveFor = (door: () => void) =>
    tasks.leaveGuard.guard(() => {
      onTabChange(PANEL_TAB.TASKS);
      door();
    })();
  const openTask = (taskId: string) => leaveFor(() => tasks.onResume(taskId));
  // Note that New task's card stands over whatever place stands, so it leaves only Settings, which takes the window, for it.
  const newTaskOver = (door: () => void) => (onTasks ? door() : leaveFor(door));
  const newTask = () => newTaskOver(() => tasks.onNewTask());
  const openPinnedTab = (pin: SidebarPin) => leaveFor(() => tasks.onOpenPinnedTab(pin));
  // Note that the Inbox, the Board, and the Automations pages are the router's places, which their navigation stands from wherever the window stands, as Admin's does.
  const openInbox = () => tasks.inboxView.onOpen();
  const openBoard = () => tasks.boardView.onOpen();
  const openAutomations = () => tasks.automationsView.onOpen();
  const openAdmin = () => tasks.adminView.onOpen();
  const goHome = () => leaveFor(() => tasks.onGoHome());
  // Home is the place shown while no task is open and nothing stands in its
  // place. New task's composer is on it, so its row draws no Draft pencil
  // for the words shown there.
  const atHome = onTasks && !standingIn && tasks.page === TASKS_PAGE.HOME;
  const newTaskIn = (repository: string) => newTaskOver(() => tasks.onNewTaskIn(repository));
  const folds = useFoldedGroups(sidebar.staged);
  const taskView = useTaskListView(tasks.workspace?.id, sidebar.staged);
  // The Tasks head's own menu, on a right-click and a long press, drawn only once it offers more than the buttons beside it.
  const newSectionButton = useRef<HTMLButtonElement | null>(null);
  const reader = useMemberDirectory();
  // Only a workspace somebody shares has people to filter by, so one nobody shares lists every task.
  const { memberCount } = tasks.workspace ?? {};
  const shared = memberCount === undefined ? (reader.members?.length ?? 0) > 1 : memberCount > 1;
  const assignedTo: AssignedTo = shared ? taskView.view.assignedTo : { kind: ASSIGNED_TO.ANYONE };
  useTaskViewCommands({
    offered: tasks.signedIn && tasks.workspace !== undefined,
    control: taskView,
    shared,
  });
  const unread = useUnreadTasks({ staged: sidebar.staged });
  const now = useMinute();
  const edge = useSidebarEdge(sidebar, sidebar.onToggle);
  const current = (taskId: string) => onTasks && !standingIn && taskId === tasks.activeTaskId;
  // An agent with no plan stands on its own page, which is the place shown while it stands.
  const agentShown = onTasks && !inAdmin ? tasks.agentView.agentId : undefined;
  const currentRow = (row: TaskRow) =>
    row.kind === TASK_ROW.TASK ? current(row.task.id) : row.agent.id === agentShown;
  const openAgent = (agentId: string) => leaveFor(() => tasks.agentView.onOpen(agentId));
  // The list is the chosen workspace's; the unread marks above read every task.
  const { listed: listedRows, listedAgents } = tasks;
  const pinned = tasks.listed.tasks.filter((task) => task.pinnedAt !== undefined);
  const pinnedAgents = listedAgents.standing.filter((agent) => agent.pinnedAt !== undefined);
  const pinnedSection = pinnedRows(pinned, pinnedAgents, listedAgents.standing, tasks);
  // The pin the open task was opened from is marked in its task's place,
  // whichever of the task's tabs is shown, while its row still stands.
  const { chosenPin } = tasks;
  const holderOpen = (row: PinnedRow) =>
    row.kind === TASK_ROW.TASK ? current(row.task.id) : row.agent.id === agentShown;
  const markedPin = pinnedSection.find(
    (row) =>
      row.pin !== undefined &&
      chosenPin !== undefined &&
      holderOpen(row) &&
      samePin(row.pin, chosenPin),
  )?.pin;
  // The account's own sections stand while a workspace is listed.
  const sectionsShown = tasks.signedIn && tasks.workspace !== undefined;
  const sectioned = sectionedTasks(
    tasks,
    sectionsShown ? tasks.workspace?.id : undefined,
    tasks.listed.tasks.filter((task) => task.pinnedAt === undefined),
    listedAgents.standing.filter((agent) => agent.pinnedAt === undefined),
  );
  // The view's filters thin the sections' tasks as they thin the list's, a row dropped among them landing among those drawn.
  // A parent stays while the view shows any child task under it, whatever its own status.
  const openParents = useMemo(
    () => openParentIds(tasks.listed.tasks, SHOWN_STATUSES),
    [tasks.listed.tasks],
  );
  const shownSections = sectioned.sections.map((drawn) =>
    sectionInView(drawn, openParents, assignedTo, tasks.me),
  );
  const sectionDialogs = useSectionDialogs(tasks, tasks.shown && overlay.inSight);
  const sectionEdits = useSectionEdits();
  // A slot a row is let go at in an open section, counted among its rows as drawn, child tasks nested, read back in the section's own order; a folded one takes it on top, as it always has.
  const sectionSlot = (target: DrawnSection, at: number) =>
    folds.sectionFolded(target.section.id)
      ? at
      : storedSlot(target.rows, drawnTaskRows(target.rows, folds.taskOpened, currentRow), at);
  // Note that the drops read the sections and Pinned as drawn, child tasks standing under their parents, once the lists below are homed.
  // Note that the sidebar draws a task in one place, so a row dragged into
  // Pinned leaves its section, and one dragged out of Pinned is unpinned and
  // stands where it was let go, under Tasks or in a section.
  const dropRow = (row: TaskRow, zone: string, at: number) => {
    const member = rowMember(row);
    if (zone === PINNED_DROP_ZONE) {
      tasks.onWriteSections(leaveSection(tasks, member));
      pinAt(pinnedSection, row, pinSlot(pinnedDrawnRows, at), tasks);
      return;
    }
    if (zone === TASKS_DROP_ZONE) {
      const sectionedIds = member.agent ? sectioned.agentIds : sectioned.taskIds;
      if (sectionedIds.has(member.id)) tasks.onWriteSections(unplaceAllWrites([member]));
      return;
    }
    const target = homedSections.find((drawn) => drawn.section.id === zone);
    if (target === undefined) return;
    tasks.onWriteSections(
      placeWrites(target.entries, member, zone, sectionSlot(target, at), Date.now()),
    );
  };
  // A tab pinned to the sidebar is no task, so it goes into no section, though Tasks unpins it as any pin.
  const dropPinned = (row: PinnedRow, zone: string, at: number) => {
    const member =
      row.pin !== undefined
        ? undefined
        : rowMember(row.kind === TASK_ROW.AGENT ? agentRow(row.agent) : taskRow(row.task));
    if (zone === TASKS_DROP_ZONE) {
      unpin(row, tasks);
      if (member !== undefined) tasks.onWriteSections(leaveSection(tasks, member));
      return;
    }
    const target = homedSections.find((drawn) => drawn.section.id === zone);
    if (target === undefined || member === undefined) return;
    unpin(row, tasks);
    tasks.onWriteSections([
      ...leaveSection(tasks, member),
      ...placeWrites(target.entries, member, zone, sectionSlot(target, at), Date.now()),
    ]);
  };
  const { chosen } = overlay;
  // The reader's own tasks, which the list holds until the reader chooses otherwise.
  const mine: AssignedTo = { kind: ASSIGNED_TO.ME };
  // The Tasks head and its list are called whose tasks the list holds.
  const tasksHead = tasksHeadWords(assignedTo, shared, reader, tasks.listed.tasks);
  // New section stands on the Tasks head while the account keeps sections.
  // Note that a new section is named in place at the foot of the sections, so the sidebar stays standing rather than being put away as a choice puts it.
  const askNewSection = () => {
    const { workspace } = tasks;
    if (workspace !== undefined) sectionEdits.beginCreate(workspace.id, newSectionButton.current);
  };
  const newSectionOffered = sectionsShown && tasks.workspace !== undefined;
  // Note that the count reads every listed task, not the rows the view draws, which hides the finished ones by default.
  const childCounts = useMemo(() => childTaskCounts(tasks.listed.tasks), [tasks.listed.tasks]);
  const context: RowContext = {
    tasks,
    current,
    marked: (taskId, pin) =>
      markedPin === undefined ? pin === undefined && current(taskId) : pin === markedPin,
    markedPin: (pin) => pin === markedPin,
    onOpen: chosen(openTask),
    // An agent's page opened from a tab pinned on it is marked in the pin's place, as a task's is.
    currentRow: (row) =>
      row.kind === TASK_ROW.AGENT &&
      markedPin !== undefined &&
      "agent" in markedPin &&
      markedPin.agent === row.agent.id
        ? false
        : currentRow(row),
    onOpenAgent: chosen(openAgent),
    onDeletedAgent: (agentId) => () => {
      if (tasks.agentView.agentId === agentId) tasks.agentView.onClose();
    },
    unread,
    unseenAgent: (agentId) =>
      tasks.unreadTabs.some(
        (tab) =>
          typeof tab !== "string" && tab.kind === STRIP_TAB_KIND.AGENT && tab.agent === agentId,
      ),
    now,
    faces: { creator: true, assignee: assignedTo.kind !== ASSIGNED_TO.MEMBER },
    inSight: overlay.inSight,
    dropOut: sectionsShown ? dropRow : undefined,
    onCarried: setCarrying,
    // Note that an archived agent stands in no section, so it is offered none until it is brought back, as an archived task.
    sectionEntry: (agent) =>
      agent.archivedAt === undefined
        ? moveToSectionEntry(
            tasks,
            { agent: true, id: agent.id },
            agent.workspaceId,
            sectionDialogs,
          )
        : undefined,
    childCount: (taskId) => childCounts.get(taskId),
    opened: folds.taskOpened,
    onFoldTask: folds.toggleTask,
    runs: runsPlace,
  };
  // A pinned tab is on show where its holder is open and its column shows it:
  // an agent's in the task's own column, any other in the side panel. The
  // pin marked stands too, so a fold never hides the row the sidebar marks, and so
  // does a pinned agent while its page stands.
  const pinnedShown = (row: PinnedRow) => {
    const { pin } = row;
    if (pin === undefined) return holderOpen(row);
    return (
      pin === markedPin ||
      (holderOpen(row) &&
        (isAgentPin(pin)
          ? sameTab(tasks.mainTabs.tab, pin.tab)
          : tasks.sidePanel.open &&
            tasks.sidePanel.tab !== undefined &&
            sameTab(tasks.sidePanel.tab, pin.tab)))
    );
  };
  // Note that the pins are never filtered, because a pin is already the
  // reader's own choice. The agents with no plan stand among the plans.
  // A task an automation's run made leaves Tasks too, once its run finished and it holds nothing of the reader's (`finished-runs.ts`).
  const unpinnedTasks = withoutFinishedRunTasks(
    listedRows.tasks.filter(
      (task) => task.pinnedAt === undefined && !sectioned.taskIds.has(task.id),
    ),
    { unread, inbox: tasks.listed.inbox, shown: current },
  );
  // An automation's finished runs leave Tasks once they hold nothing of the reader's (`finished-runs.ts`).
  const unpinnedAgents = withoutFinishedRuns(
    listedAgents.standing.filter(
      (agent) => agent.pinnedAt === undefined && !sectioned.agentIds.has(agent.id),
    ),
    {
      unseen: context.unseenAgent,
      inbox: tasks.inboxTaskless,
      me: tasks.me,
      shown: agentShown,
    },
  );
  // Note that an archived task or agent, and a finished run, which the list does not show, count for nothing here.
  const unlisted =
    listedRows.tasks.length === 0 &&
    pinnedAgents.length === 0 &&
    sectioned.agentIds.size === 0 &&
    unpinnedAgents.length === 0;
  const unpinned = [...unpinnedTasks.map(taskRow), ...unpinnedAgents.map(agentRow)];
  const rows = taskRowsAssignedTo(unpinned, assignedTo, tasks.me);
  // The list holds the tasks to do and in progress, and says how many more the Tasks page holds; a section says its own (`sectionInView`).
  const hidden = hiddenStatuses(rows, SHOWN_STATUSES, openParents);
  const statusRows = taskRowsInStatuses(rows, SHOWN_STATUSES, openParents);
  const orderView: TaskOrderView = {
    workspaceId: tasks.workspace?.id,
    grouping: taskView.view.grouping,
    assignedTo,
  };
  const placing = { grouping: orderView.grouping, pending: tasks.pendingTasks };
  // While the pointer is over the sidebar each task keeps the place it was
  // first drawn in, so one an update would sort elsewhere stays under the
  // reader's hand. Note that the hold is the pointer's and not the sidebar's
  // being in sight, because a pinned sidebar is in sight for as long as the
  // window is open, and its tasks would sort anew only at the next launch.
  const sections = useHeldOrder(orderView, tasks.shown && overlay.inSight && pointing, {
    sameOrder: sameTaskOrder,
    draw: (places: ReadonlyMap<string, TaskRow>) => {
      const placed = taskPlaces(statusRows, places, placing);
      const held = taskSections([...placed.values()], orderView.grouping, tasks);
      return liveSections(held, new Map(statusRows.map((row) => [taskRowKey(row), row])));
    },
    placesOf: (_drawn, held) => taskPlaces(statusRows, held, placing),
  });
  // A child task stands only under its parent, wherever a list draws it, and nowhere where none does (`homedTaskRows`).
  const pinnedOwn = pinnedHeld(pinnedSection);
  const homed = homedTaskRows([
    pinnedOwn,
    ...shownSections.map((drawn) => drawn.rows),
    ...taskSectionLists(sections),
  ]);
  const pinnedAdopted = (homed[0] ?? []).slice(pinnedOwn.length);
  const homedSections = shownSections.map((drawn, at) => homedSection(drawn, homed[at + 1] ?? []));
  const homedTasks = withTaskLists(sections, homed.slice(shownSections.length + 1));
  const pinnedDrawnRows = pinnedDrawn(pinnedSection, pinnedAdopted, folds.taskOpened, currentRow);
  // The tasks are chosen together across Pinned, the sections, and Tasks, only those the view draws staying chosen, a child task homed nowhere among those it does not.
  const selection = useTasksSelection(
    tasks,
    new Set(
      [
        ...pinnedSection,
        ...pinnedAdopted,
        ...homedSections.flatMap((drawn) => drawn.rows),
        ...taskSectionLists(homedTasks).flat(),
      ].flatMap((row) => (row.kind === TASK_ROW.TASK ? [row.task.id] : [])),
    ),
  );
  // A row names its repository as its group's header would, its owner's picture and its name, owner and all where two share a name.
  const named = repositoryGroups(unpinned);
  const repositoryOf = (row: TaskRow) => {
    const repository = taskRowRepository(row);
    return (
      <ReplayMask>
        <RepositoryName
          repository={repository}
          label={repository === null ? undefined : repositoryLabel(repository, named)}
          pictures={tasks.repositories.pictures}
        />
      </ReplayMask>
    );
  };
  // The rows as the list draws them: the pinned, then each group not folded
  // away, the open row standing in its place even under a fold, so walking
  // the list still moves from it.
  const pinnedWalked = pinnedTaskRows(pinnedDrawnRows);
  const sectionsDrawn = homedSections.flatMap(({ section, rows: held }) =>
    nestedRows(folds.sectionFolded(section.id) ? held.filter(currentRow) : held, folds, currentRow),
  );
  const pinnedShownDrawn = folds.pinnedFolded ? pinnedWalked.filter(currentRow) : pinnedWalked;
  const drawn = [
    ...pinnedShownDrawn,
    ...sectionsDrawn,
    ...drawnTasks(homedTasks, folds, currentRow),
  ];
  // The tasks' rows chosen together, in the order drawn, those the runs leave undrawn among them, as one run, so ⇧-click chooses across the lists.
  const chooseOrder = drawn.flatMap((row) => (row.kind === TASK_ROW.TASK ? [row.task.id] : []));
  // Moving up and down the list as it reads: down from the home page, where
  // no row is open, is the first row. The ends go no further.
  const at = drawn.findIndex((row) =>
    agentShown === undefined
      ? row.kind === TASK_ROW.TASK && row.task.id === tasks.activeTaskId
      : row.kind === TASK_ROW.AGENT && row.agent.id === agentShown,
  );
  const step = (by: number) => {
    const row = drawn[at + by];
    if (row === undefined) return;
    if (row.kind === TASK_ROW.TASK) openTask(row.task.id);
    else openAgent(row.agent.id);
  };
  const listed = tasks.signedIn && drawn.length > 0;
  useAppCommand(APP_COMMAND.PREVIOUS_TASK, listed && at > 0 ? () => step(-1) : undefined);
  useAppCommand(APP_COMMAND.NEXT_TASK, listed && at < drawn.length - 1 ? () => step(1) : undefined);

  // The pages' rows, then the rule under them, heading the tasks' scroller; on a phone, whose Tasks page this tree is, its bar holds the rest (`mobile-bar.tsx`).
  const phone = room === SHELL_ROOM.NARROW;
  const places = (
    <>
      <SidebarPlaces>
        {phone ? null : (
          <>
            <NewTaskButton
              tasks={tasks}
              // A person's page stands in Home's place without leaving its page, and draws no composer.
              shown={
                tasks.newTask.open ||
                (atHome && tasks.signedIn && tasks.personView.userId === undefined)
              }
              onNewTask={chosen(newTask)}
            />
            {/* Search is a second door to the command palette, drawn as New task
                is, since it heads the list the same way. */}
            <NavItem
              icon={<SearchIcon />}
              aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.COMMAND_PALETTE)}
              shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.COMMAND_PALETTE].chord} />}
              onClick={chosen(() => runAppCommand(APP_COMMAND.COMMAND_PALETTE))}
            >
              Search
            </NavItem>
            <SidebarHomeRow current={atHome} disabled={!tasks.signedIn} onOpen={chosen(goHome)} />
            <SidebarInboxRow
              waiting={waiting}
              current={inInbox}
              disabled={!tasks.signedIn}
              onOpen={chosen(openInbox)}
            />
          </>
        )}
        {phone ? null : (
          <SidebarTasksRow
            current={inBoard}
            disabled={!tasks.signedIn}
            onOpen={chosen(openBoard)}
            onPreload={tasks.boardView.onPreload}
          />
        )}
        <SidebarAutomationsRow
          current={inAutomations}
          failed={automationFailed}
          running={automationsRunning}
          disabled={!tasks.signedIn}
          onOpen={chosen(openAutomations)}
        />
        <SidebarAdminRow
          current={inAdmin}
          onOpen={chosen(openAdmin)}
          onPreload={tasks.adminView.onPreload}
        />
      </SidebarPlaces>
      <SidebarRule />
    </>
  );
  return (
    <PanePin
      ref={overlay.ref}
      className="desktop-sidebar"
      data-row-drop-scope=""
      inert={!overlay.inSight}
      onPin={onPressWithin}
      onPointerEnter={() => setPointing(true)}
      onPointerLeave={(event) => {
        setPointing(false);
        overlay.onPointerLeave(event);
      }}
      onKeyDown={overlay.onKeyDown}
    >
      <div className="desktop-drag-strip" />
      <HistoryButtons history={history} room={room} />
      {/* The workspace heads the sidebar once one is read, as everything under it is that
          workspace's; the app's own head stands until then. A phone heads it as it heads
          every place, the reader's face opening their workspaces and account (`phone-account.tsx`). */}
      {phone ? (
        <PhoneHead
          place="sidebar"
          start={
            tasks.signedIn ? (
              <PhoneAccount
                tasks={tasks}
                account={account}
                onSettings={chosen(() => onTabChange(PANEL_TAB.SETTINGS))}
                onSignOut={onSignOut}
              />
            ) : null
          }
          title={
            <Text
              as={TEXT_ELEMENT.H1}
              variant={TEXT_VARIANT.TOOLBAR_TITLE}
              className="ui-toolbar-title"
            >
              Tasks
            </Text>
          }
          end={null}
        />
      ) : tasks.signedIn && tasks.workspace !== undefined ? (
        <WorkspaceSwitcher tasks={tasks} inSight={overlay.inSight} />
      ) : (
        <ProductIdentity />
      )}

      {/* One scroller for the pages' rows and both sections, so neither the
          rows nor the pinned tasks hold the column above the rest: on an
          iPad's or a short window's column they left the tasks a strip. */}
      <ReplayUnmask>
        <Fill className="sidebar-section -m-ring-reach">
          <ScrollArea ref={scroller} fade={SCROLL_FADE.BOTH}>
            <ListMotion root={body}>
              <ChosenTasksContext.Provider value={selection.chosenOf}>
                <SelectionRegion
                  id={selection.regionId}
                  selection={{ selected: selection.selected, onChange: selection.onChange }}
                  order={[chooseOrder]}
                  bringIn={runs.bringIn}
                  plain={PLAIN_PRESS.CLEARS}
                >
                  <div
                    {...roving}
                    ref={bodyRef}
                    className="sidebar-section-body flex min-h-list-held flex-col p-ring-reach [&_.sidebar-group+.sidebar-group]:mt-section-gap"
                    {...motionRows()}
                  >
                    {places}
                    {/* Pinned stands once something is pinned, or, while the account keeps sections, as the place a carried row drops in, and leaves after its exit once neither holds. */}
                    <LeavingGroups
                      groups={
                        tasks.signedIn && (pinnedSection.length > 0 || (sectionsShown && carrying))
                          ? PINNED_LISTED
                          : NOTHING_LISTED
                      }
                      keyOf={(key) => key}
                      group={(key) => (
                        <PinnedSection
                          key={key}
                          rows={pinnedSection}
                          adopted={pinnedAdopted}
                          folds={folds}
                          shown={pinnedShown}
                          context={context}
                          onOpenTab={chosen(openPinnedTab)}
                          onDropOut={sectionsShown ? dropPinned : undefined}
                          carried={carrying}
                        />
                      )}
                    />
                    <SidebarSections
                      sections={homedSections}
                      workspaceId={sectionsShown ? tasks.workspace?.id : undefined}
                      context={{
                        tasks,
                        dialogs: sectionDialogs,
                        edits: sectionEdits,
                        current: currentRow,
                        unread,
                        inSight: overlay.inSight,
                        folded: folds.sectionFolded,
                        onToggle: folds.toggleSection,
                        opened: folds.taskOpened,
                        row: (held, nest, place) => {
                          const { row } = held;
                          return row.kind === TASK_ROW.TASK ? (
                            <SidebarTask
                              key={row.task.id}
                              tasks={tasks}
                              task={row.task}
                              current={context.marked(row.task.id, undefined)}
                              open={current(row.task.id)}
                              unread={unread(row.task)}
                              now={now}
                              faces={context.faces}
                              depth={held.depth}
                              nest={nest}
                              place={place}
                              fold={childTasksFold(held, folds.toggleTask)}
                              childCount={context.childCount(row.task.id)}
                              onOpen={() => context.onOpen(row.task.id)}
                            />
                          ) : (
                            <SidebarAgent
                              key={row.agent.id}
                              agent={row.agent}
                              agents={tasks.agents}
                              current={currentRow(row)}
                              now={now}
                              at={taskRowTime(row)}
                              face={context.faces.creator && context.faces.assignee}
                              nest={nest}
                              place={place}
                              shown={tasks.shown && overlay.inSight}
                              onOpen={() => context.onOpenAgent(row.agent.id)}
                              onPin={pinOf(tasks, row.agent)}
                              section={context.sectionEntry(row.agent)}
                              onDeleted={context.onDeletedAgent(row.agent.id)}
                            />
                          );
                        },
                        onDropRow: dropRow,
                        runs: runsPlace,
                        onOpenBoard: chosen(openBoard),
                        onCarried: setCarrying,
                      }}
                    />
                    <nav
                      className="sidebar-group"
                      aria-label={tasksHead}
                      data-row-drop={sectionsShown ? TASKS_DROP_ZONE : undefined}
                      {...motionRows()}
                    >
                      {tasks.signedIn ? (
                        <GroupHeader
                          heading={GROUP_HEADING.NONE}
                          label={
                            assignedTo.kind === ASSIGNED_TO.MEMBER ? (
                              <ReplayMask>{tasksHead}</ReplayMask>
                            ) : (
                              tasksHead
                            )
                          }
                          actions={
                            <>
                              {!newSectionOffered ? null : (
                                <Tooltip label={NEW_SECTION}>
                                  <IconButton
                                    ref={newSectionButton}
                                    icon={<FolderPlusIcon />}
                                    label={NEW_SECTION}
                                    size={BUTTON_SIZE.COMPACT}
                                    onClick={askNewSection}
                                  />
                                </Tooltip>
                              )}
                              <TaskViewOptions
                                shown={tasks.shown && overlay.inSight}
                                control={taskView}
                                shared={shared}
                                filtered={shared && assignedTo.kind !== mine.kind}
                              />
                            </>
                          }
                        />
                      ) : null}
                      {assignedTo.kind !== ASSIGNED_TO.ANYONE &&
                      rows.length === 0 &&
                      shownSections.every((drawn) => drawn.rows.length === 0) &&
                      !unlisted &&
                      tasks.listRead &&
                      !tasks.listFailed ? (
                        <NoteLine look={NOTE_LINE_LOOK.ROWS}>
                          {NONE_MATCH}{" "}
                          <Button
                            onClick={() => taskView.onAssignedTo({ kind: ASSIGNED_TO.ANYONE })}
                          >
                            Show all
                          </Button>
                        </NoteLine>
                      ) : null}
                      {/* Note that rows the list still holds stand with no line over them while the app is offline, since the Offline mark says why; a list with none still says it. */}
                      {tasks.listFailed && (connected || unlisted) ? (
                        <ErrorState
                          failure={unreadShown(FAILURE_SURFACE.TASKS_READ)}
                          onRetry={tasks.onRetryList}
                          placement={ERROR_STATE_PLACEMENT.ROWS}
                        >
                          Your tasks could not be read.
                        </ErrorState>
                      ) : null}
                      {/* The list is empty before its first read lands, so that it
              holds none says nothing until the service has answered. */}
                      {tasks.signedIn && unlisted && !tasks.listRead && !tasks.listFailed ? (
                        <ListSkeleton />
                      ) : null}
                      {tasks.signedIn && unlisted && tasks.listRead && !tasks.listFailed ? (
                        <NoteLine look={NOTE_LINE_LOOK.ROWS}>No tasks yet.</NoteLine>
                      ) : null}
                      {tasks.signedIn ? null : (
                        <NoteLine look={NOTE_LINE_LOOK.ROWS}>Sign in to start a task.</NoteLine>
                      )}
                      <TaskGroups
                        sections={homedTasks}
                        repositoryOf={repositoryOf}
                        folds={folds}
                        onNewTaskIn={chosen(newTaskIn)}
                        context={context}
                      />
                      <HiddenStatusesLine hidden={hidden} onOpen={chosen(openBoard)} />
                    </nav>
                  </div>
                </SelectionRegion>
              </ChosenTasksContext.Provider>
            </ListMotion>
          </ScrollArea>
        </Fill>

        {phone ? null : (
          <SidebarFoot
            account={account}
            updates={updates}
            shown={overlay.inSight}
            settingsOpen={tab === PANEL_TAB.SETTINGS}
            onSettings={chosen(() => onTabChange(PANEL_TAB.SETTINGS))}
            onSignOut={onSignOut}
          />
        )}
      </ReplayUnmask>
      {sectionDialogs.dialog}
      {selection.dialog}
      {/* Last, so the drag strip above the app's head does not take the edge's top from it. */}
      {sidebar.collapsed ? null : <ResizeEdge edge={edge} />}
    </PanePin>
  );
}

/**
 * The sidebar, read against the listed workspace's members: a teammate's
 * face on a row, a creator's group's header, and the order of those groups
 * by the names their headers say. Its links are written under that
 * workspace, which is every row's.
 *
 * A memo boundary: the shell drawn again over the same tasks, history, and
 * fold, as a setting that moves draws it, leaves the sidebar and every row
 * of it as they were.
 */
export const DesktopSidebar = memo(function DesktopSidebar(
  props: DesktopSidebarProps,
): React.JSX.Element {
  const { workspace } = props.tasks;
  return (
    <LinkWorkspaceProvider value={workspace?.slug ?? workspace?.id}>
      <MemberDirectory workspace={workspace} readerId={props.tasks.me}>
        <SidebarColumn {...props} />
      </MemberDirectory>
    </LinkWorkspaceProvider>
  );
});
