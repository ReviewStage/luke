import type { AccountSnapshot } from "@luke/credentials/snapshot";
import type { TasklessAgent } from "@luke/features/coding-agent-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import {
  inPinOrder,
  type PinPlace,
  pinPositionsForInsert,
  pinPositionsForMove,
} from "@luke/features/pin-order";
import type { TaskSectionWrite } from "@luke/features/task-section-wire";
import type { TaskStatus, TaskSummary } from "@luke/features/task-wire";
import { EXPERIMENT } from "@luke/settings";
import { APP_COMMAND, APP_SHORTCUTS } from "@luke/settings/shortcuts";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  AVATAR_SIZE,
  BUTTON_SIZE,
  Button,
  ComposeIcon,
  commandKeyshortcuts,
  dropBelowStart,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  Fill,
  GAP,
  GROUP_ACTIONS,
  GROUP_HEADING,
  GroupHeader,
  HoldPress,
  IconButton,
  joinRefs,
  LAYOUT_ELEMENT,
  ListMotion,
  MarkDoneIcon,
  MoreButton,
  motionKey,
  motionRows,
  NAV_COUNT_SHOWN,
  NAV_CURRENT,
  NavItem,
  NOTE_LINE_LOOK,
  NoteLine,
  opensMenu,
  PanePin,
  PinIcon,
  PlusIcon,
  ProviderMark,
  RESIZE_EDGE_SIDE,
  ResizeEdge,
  type ResizeEdgeHandle,
  SCROLL_FADE,
  ScrollArea,
  SearchIcon,
  Shortcut,
  Skeleton,
  SkeletonRegion,
  STATUS_TONE,
  Stack,
  Tooltip,
  UNASSIGNED_WORDS,
  UnpinIcon,
  useLeaving,
  useMenu,
  useMinute,
  useResizeEdge,
  useRovingKeys,
  VisuallyHidden,
} from "@luke/ui";
import { actorName, creatorActor, personActor } from "@luke/ui/actor-model";
import {
  FolderPlusIcon,
  FolderXIcon,
  InboxIcon,
  ListTodoIcon,
  MessagesSquareIcon,
  ShieldUserIcon,
  ZapIcon,
} from "@luke/ui/icons";
import { isAgentTab, sameTab } from "@luke/ui/tab-strip-model";
import {
  type AssigneeGroup,
  agentRow,
  assigneeGroups,
  type CreatorGroup,
  creatorGroups,
  drawnGrouping,
  hiddenStatuses,
  orderTaskRows,
  type RepositoryGroup,
  repositoryGroups,
  repositoryLabel,
  shownStatuses,
  TASK_GROUPING,
  TASK_ROW,
  type TaskOrder,
  type TaskRow,
  taskRow,
  taskRowKey,
  taskRowRepository,
  taskRowsAssignedTo,
  taskRowsCreatedBy,
  taskRowsInStatuses,
  taskRowTime,
} from "@luke/ui/task-list-model";
import {
  isAgentEntry,
  memberSection,
  placeWrites,
  type SectionMember,
  sectionOrder,
  unplaceAllWrites,
  workspaceSections,
} from "@luke/ui/task-sections-model";
import {
  repositoryPageUrl,
  SETTLED_STATUS,
  settleOffered,
  TASK_MARK,
  TASKS_PAGE,
} from "@luke/ui/tasks-model";
import type { UpdateControl } from "@luke/voice/settings-controls";
import { memo, useEffect, useMemo, useRef } from "react";
import { ACTOR_SIZE, ActorMark, actorCard, UnassignedMark } from "../actor-ref.js";
import { runAppCommand, useAppCommand } from "../app-commands.js";
import { ColumnFoot } from "../call/call-card.js";
import { useCoarsePointer } from "../coarse-pointer.js";
import { useNewTaskDrafted } from "../composer-drafts.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { DraftMark } from "../draft-mark.js";
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
import { RepositoryPicture } from "../repository-picture.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { GLYPH_STATE, stateEndMark } from "../state-glyph.js";
import { useChatOn } from "../tasks/chat-gate.js";
import { useHeldOrder } from "../tasks/use-held-order.js";
import type { InboxListing } from "../tasks/use-inbox-listing.js";
import { inColumn, type PinnedTab } from "../tasks/use-side-panel.js";
import { useUnreadTasks } from "../tasks/use-task-looks.js";
import { AUTOMATIONS_PAGE, type InboxChoice, type TasksControl } from "../tasks/use-tasks-tab.js";
import { useAdminAccess, useExperiment } from "../use-app-state.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "./action-menu.js";
import { welcomed } from "./desktop-welcome.js";
import { useFailedRunsMark } from "./failed-runs.js";
import { type FoldedGroups, useFoldedGroups } from "./folded-groups.js";
import { type HoverPane, useHoverPane } from "./hover-pane.js";
import { LukeIdentity } from "./luke-identity.js";
import { isLuke, useLukeOperator, withoutLuke } from "./luke-operator.js";
import { ADMIN_PLACE } from "./pages-on-demand.js";
import { needsYouNoun, usePlacesWaiting } from "./places-waiting.js";
import { RowPlaced, useRowMoveKeys } from "./row-moves.js";
import { SidebarAgent } from "./sidebar-agent.js";
import { SIDEBAR_WIDTH, type SidebarCollapse, sidebarInSight } from "./sidebar-collapse.js";
import { type CountNoun, foldedCount, sidebarFold, TASK_NOUN } from "./sidebar-fold.js";
import { SidebarFoot } from "./sidebar-foot.js";
import { SidebarInbox } from "./sidebar-inbox.js";
import { SidebarLuke } from "./sidebar-luke.js";
import { SidebarPinnedTab } from "./sidebar-pinned-tab.js";
import {
  type DrawnSection,
  moveToSectionEntry,
  PINNED_DROP_ZONE,
  rowMember,
  SidebarSections,
  TASKS_DROP_ZONE,
  useSectionDialogs,
} from "./sidebar-sections.js";
import {
  HiddenStatusesLine,
  TaskStatusFilter,
  TaskViewOptions,
  useTaskViewCommands,
  ViewChips,
} from "./sidebar-task-view.js";
import { type RowFaces, SidebarTask } from "./task-actions.js";
import { useTaskListView } from "./task-list-view.js";
import { useRowDrag } from "./use-row-drag.js";
import { WorkspaceSwitcher } from "./workspace-switcher.js";

/**
 * What the sidebar leaves the work column beside it, in CSS pixels: the
 * sidebar is dragged no wider than the window less this.
 */
const WORK_RESERVE = 360;

/** What the header over the tasks with no repository says. */
const NO_REPOSITORY = "No repository";

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

/** The display a browser tab answers, as against an installed web app's own window, which draws no Back of its own. */
const BROWSER_DISPLAY = "(display-mode: browser)";

/**
 * Back and forward, at the right of the left column's title-bar row, level
 * with the traffic lights, the way Cursor and Codex keep them: in the
 * column, so they ride its right edge as it is dragged and slide away with
 * it when it folds, after the column's drag strip so they claim their
 * presses back from the window frame. A way with nothing along it is dimmed
 * rather than gone, so neither button moves. The chords are the shell's to
 * offer, since they answer while the column is folded too. A phone's
 * browser tab draws none, since its own Back and Forward walk the same
 * history (`navigation-history.ts`) and the drawer's head is short of room;
 * a phone's installed web app keeps them, having no browser around it.
 */
export function HistoryButtons({
  history,
  room,
}: {
  history: NavigationHistory;
  room: ShellRoom;
}): React.JSX.Element | null {
  if (room === SHELL_ROOM.NARROW && window.matchMedia(BROWSER_DISPLAY).matches) return null;
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
      label: step.title?.label ?? UNNAMED_STEP,
      detail: step.title?.detail,
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
  readonly marked: (taskId: string, pin: PinnedTab | undefined) => boolean;
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
  /** The list's order, whose time each of its rows shows. */
  readonly order: TaskOrder;
  /** Which faces a task's row may wear: no creator's while the list holds one creator's tasks, and no assignee's while it holds those assigned to one member. */
  readonly faces: RowFaces;
  /** Whether the sidebar is in sight: folded away, nothing it opened stands over the window. */
  readonly inSight: boolean;
  /** Hears a row let go over a section, Tasks, or Pinned, while the account keeps sections; none while it does not. */
  readonly dropOut: ((row: TaskRow, zone: string, at: number) => void) | undefined;
  /** An agent's Move to section, as a task's menu offers it; none for an archived agent. */
  readonly sectionEntry: (agent: TasklessAgent) => MenuEntry | undefined;
}

/** A repository's group's key, by which it leaves the list. */
function repositoryGroupKey(group: RepositoryGroup): string {
  return group.repository ?? NO_REPOSITORY;
}

/** A creator's group's key, by which it leaves the list. */
function creatorGroupKey(group: CreatorGroup): string {
  return group.creatorId ?? NO_REPOSITORY;
}

/** An assignee's group's key, by which it leaves the list. */
function assigneeGroupKey(group: AssigneeGroup): string {
  return group.assigneeId ?? UNASSIGNED_WORDS;
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
 * lets it wear (`rowFaceOf`): under a group by creator, its assignee's alone.
 */
function TaskRows({
  rows,
  context,
  repository,
  faces = context.faces,
}: {
  rows: readonly TaskRow[];
  context: RowContext;
  repository?: (row: TaskRow) => string | undefined;
  faces?: RowFaces;
}): React.JSX.Element {
  // Note that the rows keep the view's order, so a row is dragged only out of them, into a section or Pinned.
  const { dropOut } = context;
  const drag = useRowDrag(undefined, {
    onDropOut:
      dropOut === undefined
        ? undefined
        : (from, zone, at) => {
            const row = rows[from];
            if (row !== undefined) dropOut(row, zone, at);
          },
  });
  const drawn = useLeaving(rows, taskRowKey);
  return (
    <Stack
      as={LAYOUT_ELEMENT.UL}
      gap={GAP.ROW}
      className="sidebar-tasks"
      moves
      onPointerDown={drag}
    >
      {drawn.map(({ value: row }) =>
        row.kind === TASK_ROW.TASK ? (
          <SidebarTask
            key={row.task.id}
            tasks={context.tasks}
            task={row.task}
            current={context.marked(row.task.id, undefined)}
            open={context.current(row.task.id)}
            unread={context.unread(row.task)}
            now={context.now}
            at={taskRowTime(row, context.order)}
            repository={repository?.(row)}
            faces={faces}
            onOpen={() => context.onOpen(row.task.id)}
          />
        ) : (
          <SidebarAgent
            key={row.agent.id}
            agent={row.agent}
            agents={context.tasks.agents}
            current={context.currentRow(row)}
            unread={context.unseenAgent(row.agent.id)}
            now={context.now}
            at={taskRowTime(row, context.order)}
            repository={repository?.(row)}
            face={faces.creator && faces.assignee}
            shown={context.tasks.shown && context.inSight}
            onOpen={() => context.onOpenAgent(row.agent.id)}
            onPin={pinOf(context.tasks, row.agent)}
            section={context.sectionEntry(row.agent)}
            onDeleted={context.onDeletedAgent(row.agent.id)}
          />
        ),
      )}
    </Stack>
  );
}

/** Pin or Unpin for an agent's row, the account's own; none for an archived agent, which the sidebar draws among the archived whether or not it is pinned, as a plan's. */
function pinOf(tasks: TasksControl, agent: TasklessAgent): ((pinned: boolean) => void) | undefined {
  return agent.archivedAt === undefined
    ? (pinned) => tasks.onPinAgent(agent.id, pinned)
    : undefined;
}

/** One row under Pinned: a pinned plan, a tab pinned on a listed plan, or a pinned agent with no plan, and where its pin stands. */
type PinnedRow =
  | {
      readonly kind: typeof TASK_ROW.TASK;
      readonly task: TaskSummary;
      readonly pin: PinnedTab | undefined;
      readonly place: PinPlace;
    }
  | {
      readonly kind: typeof TASK_ROW.AGENT;
      readonly agent: TasklessAgent;
      readonly place: PinPlace;
    };

/** A row under Pinned's key: its agent's or its plan's id, or where a pinned tab's pin stands. */
function pinnedRowKey(row: PinnedRow): string {
  if (row.kind === TASK_ROW.AGENT) return row.agent.id;
  return row.pin === undefined ? row.task.id : String(row.pin.at);
}

/** Where a row's pin stands, which `pin-order.ts` orders the section by. */
const placeOf = (row: PinnedRow): PinPlace => row.place;

/**
 * The rows under Pinned in the order the developer dragged them to, a pin
 * not yet dragged on top, newest pinned first (`pin-order.ts`): the pinned
 * plans, the pinned agents with no plan among them, and the tabs pinned to
 * the sidebar on plans the list holds. A tab of an archived or deleted plan
 * is drawn nowhere, its plan being out of the list.
 */
function pinnedRows(
  pinned: readonly TaskSummary[],
  agents: readonly TasklessAgent[],
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
      place: { position: agent.pinPosition, at: agent.pinnedAt ?? 0 },
    }),
  );
  const tabRows = tasks.sidePanel.pins.flatMap((pin): PinnedRow[] => {
    const task = tasks.listed.tasks.find((each) => each.id === pin.task);
    return task === undefined
      ? []
      : [{ kind: TASK_ROW.TASK, task, pin, place: { position: pin.position, at: pin.at } }];
  });
  return inPinOrder([...taskRows, ...agentRows, ...tabRows], placeOf);
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
    if (row.kind === TASK_ROW.AGENT) return [{ agent: true, id: row.agent.id, position }];
    if (row.pin === undefined) return [{ agent: false, id: row.task.id, position }];
    tabs.set(row.pin.at, position);
    before.set(row.pin.at, row.pin.position);
    return [];
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
 * rows it draws: pinned now, and given a place there, as its neighbours are
 * where they need one, wherever it lands, on top included
 * (`pinPositionsForInsert`).
 */
function pinAt(rows: readonly PinnedRow[], row: TaskRow, at: number, tasks: TasksControl): void {
  const place: PinPlace = { at: Date.now() };
  const moving: PinnedRow =
    row.kind === TASK_ROW.AGENT
      ? { kind: TASK_ROW.AGENT, agent: row.agent, place }
      : { kind: TASK_ROW.TASK, task: row.task, pin: undefined, place };
  if (row.kind === TASK_ROW.AGENT) tasks.onPinAgent(row.agent.id, true);
  else tasks.onMarkTask(row.task.id, TASK_MARK.PIN);
  placePins(pinPositionsForInsert(rows, moving, at, placeOf), tasks);
}

/** Takes a row out of Pinned: a plan's or an agent's pin on the account, a tab's on this Mac. */
function unpin(row: PinnedRow, tasks: TasksControl): void {
  if (row.kind === TASK_ROW.AGENT) tasks.onPinAgent(row.agent.id, false);
  else if (row.pin === undefined) tasks.onMarkTask(row.task.id, TASK_MARK.UNPIN);
  else tasks.sidePanel.onUnpin(row.pin.task, row.pin.tab);
}

/** The write that takes a task or an agent out of the section it is kept in, a pinned one's included; none where it is in none. */
function leaveSection(tasks: TasksControl, member: SectionMember): TaskSectionWrite[] {
  return memberSection(tasks.taskSections, member) === undefined ? [] : unplaceAllWrites([member]);
}

/** The rows of the list walked by ⌥↑ and ⌥↓ that Pinned holds: its plans and its agents, a pinned tab being its plan's. */
function pinnedTaskRows(rows: readonly PinnedRow[]): TaskRow[] {
  return rows.flatMap((row): TaskRow[] => {
    if (row.kind === TASK_ROW.AGENT) return [agentRow(row.agent)];
    return row.pin === undefined ? [taskRow(row.task)] : [];
  });
}

/**
 * The Pinned section's rows, each a plan's, an agent's, or a tab's. A tab's
 * row is keyed by when it was pinned, which no other pin shares, and a plan's
 * or an agent's by its id.
 */
function PinnedRows({
  rows,
  context,
  onOpenTab,
  movable,
  onDropOut,
}: {
  rows: readonly PinnedRow[];
  context: RowContext;
  onOpenTab: (pin: PinnedTab) => void;
  /** Whether a row is dragged to another place among them, which a fold drawing only some of them forbids. */
  movable: boolean;
  /** Hears a row let go over a section or Tasks, while the account keeps sections; none while it does not. */
  onDropOut: ((row: PinnedRow, zone: string, at: number) => void) | undefined;
}): React.JSX.Element {
  const move = movable
    ? (from: number, to: number) => movePinned(rows, from, to, context.tasks)
    : undefined;
  const drag = useRowDrag(move, {
    onDropOut:
      onDropOut === undefined
        ? undefined
        : (from, zone, at) => {
            const row = rows[from];
            if (row !== undefined) onDropOut(row, zone, at);
          },
  });
  const keys = useRowMoveKeys(move);
  // Note that a row on its way out has no place among the rows a drag or a menu moves.
  const listedAt = new Map(rows.map((row, at) => [pinnedRowKey(row), at]));
  const placeOf = (key: string) => {
    const at = listedAt.get(key);
    return move === undefined || at === undefined
      ? undefined
      : { at, count: rows.length, onMove: move };
  };
  const drawn = useLeaving(rows, pinnedRowKey);
  return (
    // An open Pinned keeps an order a row carried in lands at a place in; a folded one draws only some of its rows, so a drop lands on top.
    <Stack
      as={LAYOUT_ELEMENT.UL}
      gap={GAP.ROW}
      className="sidebar-tasks"
      data-row-drop-rows={onDropOut !== undefined && movable ? "" : undefined}
      moves
      onPointerDown={drag}
      {...keys}
    >
      {drawn.map(({ key, value: row }) => {
        if (row.kind === TASK_ROW.AGENT) {
          const { agent } = row;
          return (
            <RowPlaced key={key} place={placeOf(key)}>
              <SidebarAgent
                agent={agent}
                agents={context.tasks.agents}
                current={context.currentRow(agentRow(agent))}
                unread={context.unseenAgent(agent.id)}
                now={context.now}
                at={agent.activityAt}
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
                onOpen={() => context.onOpen(task.id)}
              />
            ) : (
              <SidebarPinnedTab
                tasks={context.tasks}
                pin={pin}
                task={task}
                current={context.marked(task.id, pin)}
                inSight={context.inSight}
                onOpen={() => onOpenTab(pin)}
                onOpenTask={() => context.onOpen(task.id)}
              />
            )}
          </RowPlaced>
        );
      })}
    </Stack>
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
 * is let go, one carried out is unpinned, and it stands though nothing is
 * pinned, saying so, so there is somewhere to drop the first pin.
 */
function PinnedSection({
  rows,
  folds,
  shown,
  context,
  onOpenTab,
  onDropOut,
}: {
  rows: readonly PinnedRow[];
  folds: FoldedGroups;
  /** Whether a row is the plan open, the agent whose page stands, or the pinned tab on show, which a fold leaves standing. */
  shown: (row: PinnedRow) => boolean;
  context: RowContext;
  onOpenTab: (pin: PinnedTab) => void;
  /** Hears a row let go over a section or Tasks, while the account keeps sections, which makes Pinned a drop zone too; none while it does not. */
  onDropOut: ((row: PinnedRow, zone: string, at: number) => void) | undefined;
}): React.JSX.Element {
  const folded = folds.pinnedFolded;
  const standing = rows.filter(shown);
  return (
    <nav
      className="sidebar-group"
      aria-label="Pinned"
      data-row-drop={onDropOut === undefined ? undefined : PINNED_DROP_ZONE}
    >
      <GroupHeader
        heading={GROUP_HEADING.NONE}
        label="Pinned"
        fold={sidebarFold(folded, folds.togglePinned)}
        count={foldedCount(folded, rows.length, PIN_NOUN, NAV_COUNT_SHOWN.ALWAYS)}
        standing={
          standing.length === 0 ? undefined : (
            <PinnedRows
              rows={standing}
              context={context}
              onOpenTab={onOpenTab}
              movable={false}
              onDropOut={onDropOut}
            />
          )
        }
      >
        {rows.length === 0 ? (
          <div className="sidebar-section-slot">
            <NoteLine look={NOTE_LINE_LOOK.INSET}>Drag tasks here to pin them</NoteLine>
          </div>
        ) : (
          <PinnedRows
            rows={rows}
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
 * right-click on the header: Pin holds the group above the rest on the
 * account, Mark all done sets every task under the header Done, which the
 * sidebar's status filter then leaves out, and Open on GitHub opens the
 * repository's page, under GitHub's mark rather than the owner's picture,
 * since it is about GitHub. Mark all done asks nothing first, since it
 * stops no agent. The tasks with no repository have no pin, since they
 * always stand last, and no page to open. A group of tasks all done
 * already offers no Mark all done, so the plans with no repository offer
 * nothing there.
 */
function repositoryActionGroups(group: RepositoryGroup, tasks: TasksControl): MenuAction[][] {
  const { repository } = group;
  const listed = groupTasks(group);
  const settle: MenuAction[] = !listed.some((task) => settleOffered(task, SETTLED_STATUS.DONE))
    ? []
    : [
        {
          label: "Mark all done",
          icon: <MarkDoneIcon />,
          onSelect: () =>
            tasks.onSettleTasks(
              listed.map(({ id }) => id),
              SETTLED_STATUS.DONE,
            ),
        },
      ];
  if (repository === null) return settle.length === 0 ? [] : [settle];
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
  return [[pin, ...settle], [github]];
}

/** Pinned holds tabs as well as tasks, so its count is read as pins. */
const PIN_NOUN: CountNoun = { one: "pin", many: "pins" };

/** The tasks under a repository's header; an agent with no task under it is archived from its own page. */
function groupTasks(group: RepositoryGroup): readonly TaskSummary[] {
  return group.rows.flatMap((row) => (row.kind === TASK_ROW.TASK ? [row.task] : []));
}

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
            <FolderXIcon />
          ) : (
            <RepositoryPicture
              repository={repository}
              pictures={context.tasks.repositories.pictures}
              size={AVATAR_SIZE.GLYPH}
            />
          )
        }
        label={named}
        fold={sidebarFold(folded, () => folds.toggle(repository))}
        count={foldedCount(folded, group.rows.length, TASK_NOUN)}
        mark={
          repository !== null && context.tasks.pinnedRepositories.includes(repository) ? (
            <span className="sidebar-repository-pinned">
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
              <Tooltip label={`New task in ${label}`}>
                <IconButton
                  icon={<PlusIcon />}
                  label={`New task in ${label}`}
                  size={BUTTON_SIZE.COMPACT}
                  onClick={() => onNewTaskIn(repository)}
                />
              </Tooltip>
            )}
          </>
        }
      >
        {group.rows.length === 0 ? null : <TaskRows rows={group.rows} context={context} />}
      </GroupHeader>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${named} actions`}
          menu={menu.drawn}
          groups={actionGroups}
          onClose={menu.close}
        />
      )}
    </div>
  );
}

/**
 * One creator's tasks under a header naming them by face, the reader's own
 * as You, a former member's on the quiet outline, hanging their card,
 * folded and kept as a repository's group is. The face is the group's to
 * say, so the rows wear none, and name no repository either, which the
 * row's card names.
 */
function CreatorSection({
  group,
  folds,
  context,
}: {
  group: CreatorGroup;
  folds: FoldedGroups;
  context: RowContext;
}): React.JSX.Element {
  const reader = useMemberDirectory();
  const first = group.rows[0];
  const actor = creatorActor(first === undefined ? {} : creatorOf(first), reader, undefined);
  const folded = folds.creatorFolded(group.creatorId);
  const standing = group.rows.filter(context.currentRow);
  const faces = { ...context.faces, creator: false };
  return (
    <div className="sidebar-repository" {...motionKey(creatorGroupKey(group))}>
      <GroupHeader
        heading={GROUP_HEADING.NONE}
        glyph={<ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />}
        label={actorName(actor)}
        card={actorCard(actor)}
        fold={sidebarFold(folded, () => folds.toggleCreator(group.creatorId))}
        count={foldedCount(folded, group.rows.length, TASK_NOUN)}
        standing={
          standing.length === 0 ? undefined : (
            <TaskRows rows={standing} context={context} faces={faces} />
          )
        }
      >
        {group.rows.length === 0 ? null : (
          <TaskRows rows={group.rows} context={context} faces={faces} />
        )}
      </GroupHeader>
    </div>
  );
}

/** Who a row is assigned to, as their face and name are read: a task's assignee, or whoever started the agent; none where no one is. */
function assigneeOf(row: TaskRow): TaskSummary["assignee"] {
  return row.kind === TASK_ROW.TASK ? row.task.assignee : row.agent.startedBy;
}

/**
 * One assignee's tasks under a header naming them by face, the reader's own
 * as You and a former member's grayed, hanging their card, and the tasks no
 * one is assigned to under Unassigned on the dashed mark, folded and kept
 * as a creator's group is. The face is the group's to say, so the rows wear
 * none, and name no repository either, which the row's card names.
 */
function AssigneeSection({
  group,
  folds,
  context,
}: {
  group: AssigneeGroup;
  folds: FoldedGroups;
  context: RowContext;
}): React.JSX.Element {
  const reader = useMemberDirectory();
  const first = group.rows[0];
  const assignee = first === undefined ? undefined : assigneeOf(first);
  const actor =
    assignee === undefined
      ? undefined
      : personActor(assignee, reader.members, reader.readerId, reader.former);
  const folded = folds.assigneeFolded(group.assigneeId);
  const standing = group.rows.filter(context.currentRow);
  const faces = { ...context.faces, assignee: false };
  return (
    <div className="sidebar-repository" {...motionKey(assigneeGroupKey(group))}>
      <GroupHeader
        heading={GROUP_HEADING.NONE}
        glyph={
          actor === undefined ? (
            <UnassignedMark size={ACTOR_SIZE.INLINE} decorative />
          ) : (
            <ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />
          )
        }
        label={actor === undefined ? UNASSIGNED_WORDS : actorName(actor)}
        card={actor === undefined ? undefined : actorCard(actor)}
        fold={sidebarFold(folded, () => folds.toggleAssignee(group.assigneeId))}
        count={foldedCount(folded, group.rows.length, TASK_NOUN)}
        standing={
          standing.length === 0 ? undefined : (
            <TaskRows rows={standing} context={context} faces={faces} />
          )
        }
      >
        {group.rows.length === 0 ? null : (
          <TaskRows rows={group.rows} context={context} faces={faces} />
        )}
      </GroupHeader>
    </div>
  );
}

/** What the list says where its filters leave nothing, as the Tasks page says it. */
const NONE_MATCH = "No tasks match this view.";

/** Who created a row, as its creator's face and name are read: a task's creator and owner, or whoever started the agent. */
function creatorOf(row: TaskRow): Pick<TaskSummary, "createdBy" | "ownerId"> {
  if (row.kind === TASK_ROW.TASK) return row.task;
  const { startedBy } = row.agent;
  return startedBy === undefined ? {} : { createdBy: startedBy, ownerId: startedBy.userId };
}

/** The listed tasks as the view groups them: by repository, by assignee, by creator, or in one run. */
type TaskSections =
  | {
      readonly grouping: typeof TASK_GROUPING.REPOSITORY;
      readonly groups: readonly RepositoryGroup[];
    }
  | { readonly grouping: typeof TASK_GROUPING.ASSIGNEE; readonly groups: readonly AssigneeGroup[] }
  | { readonly grouping: typeof TASK_GROUPING.CREATOR; readonly groups: readonly CreatorGroup[] }
  | { readonly grouping: typeof TASK_GROUPING.NONE; readonly rows: readonly TaskRow[] };

/**
 * The tasks under Tasks as the view groups and orders them. Grouped by
 * repository, the pinned repositories' groups stand above the rest, newest
 * pinned first, and the rest keep the order's.
 */
function taskSections(
  rows: readonly TaskRow[],
  grouping: TaskSections["grouping"],
  order: TaskOrder,
  tasks: TasksControl,
  creatorName: (row: TaskRow) => string,
  assigneeName: (row: TaskRow) => string,
): TaskSections {
  if (grouping === TASK_GROUPING.ASSIGNEE) {
    return { grouping, groups: assigneeGroups(rows, order, tasks.me, assigneeName) };
  }
  if (grouping === TASK_GROUPING.CREATOR) {
    return { grouping, groups: creatorGroups(rows, order, tasks.me, creatorName) };
  }
  if (grouping === TASK_GROUPING.NONE) return { grouping, rows: orderTaskRows(rows, order) };
  const grouped = repositoryGroups(rows, order);
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
    folded ? rows.filter(current) : rows;
  switch (sections.grouping) {
    case TASK_GROUPING.REPOSITORY:
      return sections.groups.flatMap((group) => under(folds.folded(group.repository), group.rows));
    case TASK_GROUPING.ASSIGNEE:
      return sections.groups.flatMap((group) =>
        under(folds.assigneeFolded(group.assigneeId), group.rows),
      );
    case TASK_GROUPING.CREATOR:
      return sections.groups.flatMap((group) =>
        under(folds.creatorFolded(group.creatorId), group.rows),
      );
    case TASK_GROUPING.NONE:
      return [...sections.rows];
  }
}

/** What decides where the Tasks section stands its rows: the workspace listed, the grouping, the order, and the filters. */
interface TaskOrderView {
  readonly workspaceId: string | undefined;
  readonly grouping: TaskSections["grouping"];
  readonly order: TaskOrder;
  readonly statuses: readonly TaskStatus[];
  readonly createdBy: string | undefined;
  readonly assignedTo: string | undefined;
}

/** Whether the Tasks section drawn under one view stands its rows as it would under another. */
function sameTaskOrder(was: TaskOrderView, now: TaskOrderView): boolean {
  return (
    was.workspaceId === now.workspaceId &&
    was.grouping === now.grouping &&
    was.order === now.order &&
    was.createdBy === now.createdBy &&
    was.assignedTo === now.assignedTo &&
    was.statuses.length === now.statuses.length &&
    was.statuses.every((status, at) => status === now.statuses[at])
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
    case TASK_GROUPING.ASSIGNEE:
      return {
        ...sections,
        groups: sections.groups.map((group) => ({ ...group, rows: now(group.rows) })),
      };
    case TASK_GROUPING.CREATOR:
      return {
        ...sections,
        groups: sections.groups.map((group) => ({ ...group, rows: now(group.rows) })),
      };
    case TASK_GROUPING.NONE:
      return { ...sections, rows: now(sections.rows) };
  }
}

/** The group a row stands in under a grouping, by what keys it: its repository, its assignee's or creator's id, or the one run's. */
function groupOf(row: TaskRow, grouping: TaskSections["grouping"]): string | null | undefined {
  switch (grouping) {
    case TASK_GROUPING.REPOSITORY:
      return taskRowRepository(row);
    case TASK_GROUPING.ASSIGNEE:
      return assigneeOf(row)?.userId;
    case TASK_GROUPING.CREATOR: {
      const { createdBy, ownerId } = creatorOf(row);
      return createdBy?.userId ?? ownerId;
    }
    case TASK_GROUPING.NONE:
      return null;
  }
}

/**
 * Where each row stands, as the sections order and group it: the row as it
 * was first drawn while the sidebar is in sight (`use-held-order.ts`), or as
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
  repositoryOf: (row: TaskRow) => string | undefined;
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
    case TASK_GROUPING.ASSIGNEE:
      return (
        <LeavingGroups
          key={sections.grouping}
          groups={sections.groups}
          keyOf={assigneeGroupKey}
          group={(group) => (
            <AssigneeSection
              key={assigneeGroupKey(group)}
              group={group}
              folds={folds}
              context={context}
            />
          )}
        />
      );
    case TASK_GROUPING.CREATOR:
      return (
        <LeavingGroups
          key={sections.grouping}
          groups={sections.groups}
          keyOf={creatorGroupKey}
          group={(group) => (
            <CreatorSection
              key={creatorGroupKey(group)}
              group={group}
              folds={folds}
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

/**
 * The Inbox's row, last of the rows heading the list and drawn as they are:
 * the tray, its name, and how many items wait on the developer across every
 * task at its end, the sum of the counts the Inbox's rows show, in even
 * figures and the needs-you tone the rows it counts wear, since they wait on
 * the developer, and nothing at none. Its chord takes the count's place
 * while the row is hovered or reached from the keyboard, as New task's and
 * Search's show theirs. A press opens the window's Inbox
 * (`desktop-inbox.tsx`), and the row is the place shown while it stands.
 */
function SidebarInboxRow({
  waiting,
  current,
  disabled,
  onOpen,
}: {
  waiting: number;
  current: boolean;
  disabled: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <NavItem
      icon={<InboxIcon />}
      current={current ? NAV_CURRENT.PAGE : undefined}
      count={{
        value: waiting,
        noun: needsYouNoun(waiting),
        tone: STATUS_TONE.ATTENTION,
      }}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.INBOX)}
      shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.INBOX].chord} />}
      disabled={disabled}
      onClick={onOpen}
    >
      Inbox
    </NavItem>
  );
}

/**
 * Chat's row, under the Inbox's and drawn as it is: the glyph, its name, and
 * how many messages wait on the developer in For you at its end, in the
 * Inbox's even figures and its needs-you tone, since both count what waits on
 * the reader, nothing at none. A press opens the window's Chat
 * (`desktop-chat.tsx`), and the row is the place shown while it stands.
 */
function SidebarChatRow({
  waiting,
  current,
  onOpen,
}: {
  waiting: number;
  current: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <NavItem
      icon={<MessagesSquareIcon />}
      current={current ? NAV_CURRENT.PAGE : undefined}
      count={{
        value: waiting,
        noun: needsYouNoun(waiting),
        tone: STATUS_TONE.ATTENTION,
      }}
      onClick={onOpen}
    >
      Chat
    </NavItem>
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
 * The Tasks page's row, under the Inbox's. A press opens the listed
 * workspace's tasks as a List or a Board (`tasks-page.tsx`), as its chord
 * does, and the row is the place shown while it stands. It is always offered.
 */
function SidebarTasksRow({
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
      icon={<ListTodoIcon />}
      current={current ? NAV_CURRENT.PAGE : undefined}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.TASKS)}
      shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.TASKS].chord} />}
      disabled={disabled}
      onClick={onOpen}
    >
      Tasks
    </NavItem>
  );
}

/**
 * The Automations page's row, after Chat's and drawn as it is: the
 * zap, its name, and its chord. A press opens the window's Automations page
 * (`automations-page.tsx`), and the row is the place shown while it stands.
 * While a run of the account's own automation failed to start since that
 * automation was opened, the row wears the failed mark at its end, where the
 * Inbox's count stands on its row, giving way to the chord as that does.
 */
function SidebarAutomationsRow({
  current,
  failed,
  disabled,
  onOpen,
}: {
  current: boolean;
  failed: boolean;
  disabled: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <NavItem
      icon={<ZapIcon />}
      current={current ? NAV_CURRENT.PAGE : undefined}
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
 * window's Admin place (`desktop-admin.tsx`), which takes the whole window
 * as Settings does, its sections listed where this sidebar stood. Note that
 * the row is a convenience: the service's own gate decides every read the
 * place makes.
 */
function SidebarAdminRow({ onOpen }: { onOpen: () => void }): React.JSX.Element | null {
  const admin = useAdminAccess();
  if (!admin) return null;
  return (
    <NavItem
      icon={<ShieldUserIcon />}
      // The pointer on the row is the way to the place, so its chunk, charts and all, is read now rather than at the press.
      onPointerEnter={ADMIN_PLACE.prefetch}
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
 * A section as the view's filters leave it: its tasks of the statuses shown,
 * and any with no status, an agent's among them, of the creator and the
 * assignee the view names, where it names them, each with its entry, in its
 * order.
 */
function sectionInView(
  drawn: DrawnSection,
  statuses: readonly TaskStatus[],
  createdBy: string | undefined,
  assignedTo: string | undefined,
): DrawnSection {
  const people = new Set(taskRowsAssignedTo(taskRowsCreatedBy(drawn.rows, createdBy), assignedTo));
  const shown = (row: TaskRow) =>
    people.has(row) &&
    (row.kind === TASK_ROW.AGENT ||
      row.task.status === undefined ||
      statuses.includes(row.task.status));
  const kept = drawn.rows.flatMap((row, at) => {
    const entry = drawn.entries[at];
    return entry !== undefined && shown(row) ? [{ entry, row }] : [];
  });
  return {
    ...drawn,
    entries: kept.map(({ entry }) => entry),
    rows: kept.map(({ row }) => row),
  };
}

/** New section, at the head of Tasks while the account keeps sections: it opens the section dialog in the listed workspace. */
function NewSectionButton({ onNew }: { onNew: () => void }): React.JSX.Element {
  return (
    <Tooltip label="New section">
      <IconButton icon={<FolderPlusIcon />} label="New section" onClick={onNew} />
    </Tooltip>
  );
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
  /** The room the panel's stage gives; narrow, the sidebar is a phone's drawer, whose page rows scroll away with its tasks. Wide where left out. */
  room?: ShellRoom | undefined;
  /** The window's Inbox as the shell read it, which the sidebar lists in its task list's place while the account has the inbox-first sidebar on; none while it is off. */
  inboxListing?: InboxListing | undefined;
}

/**
 * New task, heading the list: a press opens the New task dialog at once, as
 * the menu bar's and the chord's New task do, whose name field also
 * searches the workspace's Linear issues where Linear is connected
 * (`new-task-dialog.tsx`). While words left in its card wait as the
 * workspace's draft, it wears the Draft pencil at its end, which its chord
 * takes the place of while it is hovered; none while the card or a new
 * account's welcome, whose composer shows those words, is open, as a task
 * open wears none.
 */
function NewTaskButton({
  tasks,
  shown,
  onNewTask,
}: {
  tasks: TasksControl;
  /** Whether New task's words are in sight: its card open, or a new account's welcome shown. */
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
 * (`workspace-switcher.tsx`), or Luke while no workspace is read; the way to
 * a new task, Search, which opens the command palette, every task of the
 * workspace chosen, and the account's
 * row, whose menu and gear lead to Settings and the rest. The Inbox's row
 * and the Automations page's follow Search above the rule: the Inbox's
 * counts what waits on the developer and opens the window's Inbox, which is
 * also where the window rests with no task open (`resting-page.ts`), and
 * the Automations page's opens the window's Automations page; Chat's, where
 * a chat is read, counts what waits on the developer in Chat and opens it. The pinned tasks, and the side panel tabs
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
 * column beside it.
 * The open task's row is marked, or, where the task was opened from a pin,
 * that pin's row, while the task stays open.
 * A task's actions are a right-click on it away, whether or not it is open.
 * The strip above Luke is the window's drag handle and the traffic lights'
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
  inboxListing,
}: DesktopSidebarProps): React.JSX.Element {
  const onTasks = tab === PANEL_TAB.TASKS;
  const narrow = room === SHELL_ROOM.NARROW;
  const coarse = useCoarsePointer();
  const overlay = useFloatingSidebar(sidebar);
  useFirstUsableSpan(tasks);
  const body = useRef<HTMLDivElement>(null);
  // The column's rows, Luke's, the pins', and every group's tasks and agents, are one Tab stop that ↑↓ walk, a folded group's passed by.
  const roving = useRovingKeys<HTMLDivElement>();
  const bodyRef = useMemo(() => joinRefs(body, roving.ref), [roving.ref]);
  // The window's Inbox, an agent's page, the Automations page, Chat, and the Board stand in the task's place, so while one does no task is the place shown.
  const inInbox = onTasks && tasks.inboxView.open;
  const inAutomations = onTasks && tasks.automationsView.open;
  const inChat = onTasks && tasks.chatView.open;
  const inBoard = onTasks && tasks.boardView.open;
  // Opening an automation sees its failed run, which the Automations row is marked for until then.
  const { place: automationsPlace } = tasks.automationsView;
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
    inChat ||
    inBoard ||
    (onTasks && tasks.agentView.agentId !== undefined);
  // Chat is an experiment: its row stands only while the account has it on.
  const chatOn = useChatOn();
  const inboxFirst = useExperiment(EXPERIMENT.INBOX_FIRST);
  // With the inbox-first sidebar on, the Inbox's items stand where the task list stood, under the pins, and the tasks are a page of their own.
  const listsInbox = inboxFirst && tasks.signedIn && inboxListing !== undefined;
  const waiting = usePlacesWaiting(tasks);
  // A press in the list is always about tasks, so it brings the Tasks tab
  // forward from Settings as well as choosing.
  const openTask = (taskId: string) => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
    tasks.onSelect(taskId);
  };
  const showTasks = () => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
  };
  const newTask = () => {
    showTasks();
    tasks.onNewTask();
  };
  const openPinnedTab = (pin: PinnedTab) => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
    tasks.onOpenPinnedTab(pin);
  };
  const openInboxItem = (choice: InboxChoice) => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
    tasks.inboxView.onOpenItem(choice);
  };
  const openInbox = () => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
    tasks.inboxView.onOpen();
  };
  const openBoard = () => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
    tasks.boardView.onOpen();
  };
  const openAutomations = () => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
    tasks.automationsView.onOpen();
  };
  const openChat = () => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
    tasks.chatView.onOpen();
  };
  const openAdmin = () => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
    tasks.adminView.onOpen();
  };
  // A new account's welcome stands while no task is open, nothing stands in
  // its place, and no launch is still reopening a task: New task's composer is
  // on it, so its row draws no Draft pencil for the words shown there.
  const atWelcome =
    onTasks && !standingIn && tasks.page === TASKS_PAGE.HOME && !tasks.restoring && welcomed(tasks);
  const newTaskIn = (repository: string) => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
    tasks.onNewTaskIn(repository);
  };
  const folds = useFoldedGroups(sidebar.staged);
  const taskView = useTaskListView(tasks.workspace?.id, sidebar.staged);
  // The status filter's menu, which its button on the Tasks head and the hidden tasks' line both open.
  const statusMenu = useMenu(tasks.shown && overlay.inSight);
  const reader = useMemberDirectory();
  // Only a workspace somebody shares has creators to group and filter by.
  const { memberCount } = tasks.workspace ?? {};
  const shared = memberCount === undefined ? (reader.members?.length ?? 0) > 1 : memberCount > 1;
  const createdBy = shared ? taskView.view.createdBy : undefined;
  const assignedTo = shared ? taskView.view.assignedTo : undefined;
  useTaskViewCommands({
    offered: tasks.signedIn && tasks.workspace !== undefined,
    control: taskView,
    shared,
    readerId: tasks.me,
  });
  const unread = useUnreadTasks(tasks.tasks, {
    listRead: tasks.listRead,
    staged: sidebar.staged,
  });
  const now = useMinute();
  const edge = useSidebarEdge(sidebar, sidebar.onToggle);
  const current = (taskId: string) => onTasks && !standingIn && taskId === tasks.activeTaskId;
  // An agent with no plan stands on its own page, which is the place shown while it stands.
  const agentShown = onTasks ? tasks.agentView.agentId : undefined;
  const currentRow = (row: TaskRow) =>
    row.kind === TASK_ROW.TASK ? current(row.task.id) : row.agent.id === agentShown;
  const openAgent = (agentId: string) => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
    tasks.agentView.onOpen(agentId);
  };
  // Luke stands in his own row at the list's head, so every other place leaves him out.
  const operator = useLukeOperator({
    accountId: tasks.me,
    workspaceId: tasks.signedIn ? tasks.workspace?.id : undefined,
  });
  const lukeId = operator?.agentId;
  // The list is the chosen workspace's; the unread marks above read every task.
  const { listed: listedRows } = tasks;
  const listedAgents = {
    standing: withoutLuke(tasks.listedAgents.standing, operator),
    archived: tasks.listedAgents.archived,
  };
  // Note that an archived task or agent, which the list no longer shows, counts for nothing here.
  const unlisted = listedRows.tasks.length === 0 && listedAgents.standing.length === 0;
  const pinned = tasks.listed.tasks.filter((task) => task.pinnedAt !== undefined);
  const pinnedAgents = listedAgents.standing.filter((agent) => agent.pinnedAt !== undefined);
  const pinnedSection = pinnedRows(pinned, pinnedAgents, tasks);
  // The pin the open task was opened from is marked in its task's place,
  // whichever of the task's tabs is shown, while its row still stands.
  const { chosenPin } = tasks;
  const pinMarked = pinnedSection.find(
    (row) =>
      row.kind === TASK_ROW.TASK &&
      row.pin !== undefined &&
      chosenPin !== undefined &&
      current(row.task.id) &&
      row.pin.task === chosenPin.task &&
      row.pin.at === chosenPin.at,
  );
  const markedPin = pinMarked?.kind === TASK_ROW.TASK ? pinMarked.pin : undefined;
  // The account's own sections stand while a workspace is listed.
  const sectionsShown = tasks.signedIn && tasks.workspace !== undefined && !listsInbox;
  const sectioned = sectionedTasks(
    tasks,
    sectionsShown ? tasks.workspace?.id : undefined,
    tasks.listed.tasks.filter((task) => task.pinnedAt === undefined),
    listedAgents.standing.filter((agent) => agent.pinnedAt === undefined),
  );
  // The view's filters thin the sections' tasks as they thin the list's, a row dropped among them landing among those drawn.
  const statuses = shownStatuses(taskView.view);
  const shownSections = sectioned.sections.map((drawn) =>
    sectionInView(drawn, statuses, createdBy, assignedTo),
  );
  const sectionDialogs = useSectionDialogs(tasks, tasks.shown && overlay.inSight);
  // Note that the sidebar draws a task in one place, so a row dragged into
  // Pinned leaves its section, and one dragged out of Pinned is unpinned and
  // stands where it was let go, under Tasks or in a section.
  const dropRow = (row: TaskRow, zone: string, at: number) => {
    const member = rowMember(row);
    if (zone === PINNED_DROP_ZONE) {
      tasks.onWriteSections(leaveSection(tasks, member));
      pinAt(pinnedSection, row, at, tasks);
      return;
    }
    if (zone === TASKS_DROP_ZONE) {
      const sectionedIds = member.agent ? sectioned.agentIds : sectioned.taskIds;
      if (sectionedIds.has(member.id)) tasks.onWriteSections(unplaceAllWrites([member]));
      return;
    }
    const target = shownSections.find((drawn) => drawn.section.id === zone);
    if (target === undefined) return;
    tasks.onWriteSections(placeWrites(target.entries, member, zone, at, Date.now()));
  };
  // A tab pinned to the sidebar is no task, so it goes into no section, though Tasks unpins it as any pin.
  const dropPinned = (row: PinnedRow, zone: string, at: number) => {
    const member =
      row.kind === TASK_ROW.AGENT
        ? rowMember(agentRow(row.agent))
        : row.pin === undefined
          ? rowMember(taskRow(row.task))
          : undefined;
    if (zone === TASKS_DROP_ZONE) {
      unpin(row, tasks);
      if (member !== undefined) tasks.onWriteSections(leaveSection(tasks, member));
      return;
    }
    const target = shownSections.find((drawn) => drawn.section.id === zone);
    if (target === undefined || member === undefined) return;
    unpin(row, tasks);
    tasks.onWriteSections([
      ...leaveSection(tasks, member),
      ...placeWrites(target.entries, member, zone, at, Date.now()),
    ]);
  };
  const { chosen } = overlay;
  const context: RowContext = {
    tasks,
    current,
    marked: (taskId, pin) =>
      markedPin === undefined ? pin === undefined && current(taskId) : pin === markedPin,
    onOpen: chosen(openTask),
    currentRow,
    onOpenAgent: chosen(openAgent),
    onDeletedAgent: (agentId) => () => {
      if (tasks.agentView.agentId === agentId) tasks.agentView.onClose();
    },
    unread,
    unseenAgent: (agentId) =>
      tasks.unreadTabs.some((tab) => isAgentTab(tab) && tab.agent === agentId),
    now,
    order: taskView.view.order,
    faces: { creator: createdBy === undefined, assignee: assignedTo === undefined },
    inSight: overlay.inSight,
    dropOut: sectionsShown ? dropRow : undefined,
    // Note that an archived agent stands in no section, so it is offered none until it is brought back, as an archived task.
    sectionEntry: (agent) =>
      agent.archivedAt === undefined
        ? moveToSectionEntry(
            tasks,
            { agent: true, id: agent.id },
            agent.workspaceId,
            sectionDialogs.askNew,
          )
        : undefined,
  };
  // A pinned tab is on show where its task is open and its column shows it:
  // an agent's or the Inbox in the task's own column, any other in the side panel. The
  // pin marked stands too, so a fold never hides the row the sidebar marks, and so
  // does a pinned agent while its page stands.
  const pinnedShown = (row: PinnedRow) => {
    if (row.kind === TASK_ROW.AGENT) return row.agent.id === agentShown;
    const { task, pin } = row;
    return (
      (pin !== undefined && pin === markedPin) ||
      (current(task.id) &&
        (pin === undefined ||
          (inColumn(pin.tab)
            ? sameTab(tasks.mainTabs.tab, pin.tab)
            : tasks.sidePanel.open &&
              tasks.sidePanel.tab !== undefined &&
              sameTab(tasks.sidePanel.tab, pin.tab))))
    );
  };
  // Note that the pins are never filtered, because a pin is already the
  // reader's own choice. The agents with no plan stand among the plans.
  const unpinnedTasks = listedRows.tasks.filter(
    (task) => task.pinnedAt === undefined && !sectioned.taskIds.has(task.id),
  );
  const unpinnedAgents = listedAgents.standing.filter(
    (agent) => agent.pinnedAt === undefined && !sectioned.agentIds.has(agent.id),
  );
  const unpinned = [...unpinnedTasks.map(taskRow), ...unpinnedAgents.map(agentRow)];
  const rows = taskRowsAssignedTo(taskRowsCreatedBy(unpinned, createdBy), assignedTo);
  // The status filter thins the tasks listed.
  const sectionRows = sectioned.sections.flatMap((drawn) => drawn.rows);
  const hidden = hiddenStatuses([...sectionRows, ...rows], statuses);
  const statusRows = taskRowsInStatuses(rows, statuses);
  const { grouping, order } = taskView.view;
  const orderView: TaskOrderView = {
    workspaceId: tasks.workspace?.id,
    grouping: drawnGrouping(grouping, shared),
    order,
    statuses,
    createdBy,
    assignedTo,
  };
  const placing = { grouping: orderView.grouping, pending: tasks.pendingTasks };
  // While the sidebar is in sight each task keeps the place it was first drawn in, so one an update would sort elsewhere stays under the reader's eye.
  const sections = useHeldOrder(orderView, tasks.shown && overlay.inSight, {
    sameOrder: sameTaskOrder,
    draw: (places: ReadonlyMap<string, TaskRow>) => {
      const placed = taskPlaces(statusRows, places, placing);
      const held = taskSections(
        [...placed.values()],
        orderView.grouping,
        order,
        tasks,
        // A creator's or an assignee's group is ordered by the name its header says.
        (row) => actorName(creatorActor(creatorOf(row), reader, undefined)),
        (row) => {
          const assignee = assigneeOf(row);
          return assignee === undefined
            ? UNASSIGNED_WORDS
            : actorName(personActor(assignee, reader.members, reader.readerId, reader.former));
        },
      );
      return liveSections(held, new Map(statusRows.map((row) => [taskRowKey(row), row])));
    },
    placesOf: (_drawn, held) => taskPlaces(statusRows, held, placing),
  });
  // A row names its repository as its group's header would, owner and all where two share a name.
  const named = repositoryGroups(unpinned);
  const repositoryOf = (row: TaskRow) => {
    const repository = taskRowRepository(row);
    return repository === null ? NO_REPOSITORY : repositoryLabel(repository, named);
  };
  // The rows as the list draws them: the pinned, then each group not folded
  // away, the open row standing in its place even under a fold, so walking
  // the list still moves from it.
  const pinnedDrawn = pinnedTaskRows(pinnedSection);
  const sectionsDrawn = shownSections.flatMap(({ section, rows: held }) =>
    folds.sectionFolded(section.id) ? held.filter(currentRow) : held,
  );
  const pinnedShownDrawn = folds.pinnedFolded ? pinnedDrawn.filter(currentRow) : pinnedDrawn;
  const drawn = [...pinnedShownDrawn, ...sectionsDrawn, ...drawnTasks(sections, folds, currentRow)];
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

  // The pages' rows, then the rule under them. Beside the work they stand
  // put over the tasks' scroller; in a phone's drawer they scroll away with
  // the tasks, so the tasks are not left a strip under them. Note that they
  // are drawn again where the room flips, since they move between parents:
  // no CSS gives them one place without the desktop's sidebar or the
  // drawer's scroller changing, and only a browser window dragged across
  // the line flips the room, a phone standing narrow either way up
  // (`shell-room.ts`). They hold nothing that a fresh draw loses.
  const places = (
    <>
      <div className="sidebar-places">
        <NewTaskButton
          tasks={tasks}
          // A person's page stands in the welcome's place without leaving its page, and draws no composer.
          shown={tasks.newTask.open || (atWelcome && tasks.personView.userId === undefined)}
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
        {listsInbox ? null : (
          <SidebarInboxRow
            waiting={waiting.inbox}
            current={inInbox}
            disabled={!tasks.signedIn}
            onOpen={chosen(openInbox)}
          />
        )}
        <SidebarTasksRow current={inBoard} disabled={!tasks.signedIn} onOpen={chosen(openBoard)} />
        {/* Chat's row stands while the account has it on wherever there is a chat to read: a signed-in run, or a fixture's staged one. */}
        {chatOn && tasks.signedIn && tasks.chatView.available ? (
          <SidebarChatRow waiting={waiting.chat} current={inChat} onOpen={chosen(openChat)} />
        ) : null}
        <SidebarAutomationsRow
          current={inAutomations}
          failed={automationFailed}
          disabled={!tasks.signedIn}
          onOpen={chosen(openAutomations)}
        />
        <SidebarAdminRow onOpen={chosen(openAdmin)} />
      </div>
      <hr className="sidebar-rule" />
    </>
  );
  return (
    <PanePin
      ref={overlay.ref}
      className="desktop-sidebar"
      data-row-drop-scope=""
      inert={!overlay.inSight}
      onPin={onPressWithin}
      onPointerLeave={overlay.onPointerLeave}
      onKeyDown={overlay.onKeyDown}
    >
      <div className="desktop-drag-strip" />
      <HistoryButtons history={history} room={room} />
      {/* The workspace heads the sidebar once one is read, as everything under it is that
          workspace's; Luke's own head stands until then. */}
      {tasks.signedIn && tasks.workspace !== undefined ? (
        <WorkspaceSwitcher tasks={tasks} inSight={overlay.inSight} />
      ) : (
        <LukeIdentity />
      )}

      {narrow ? null : places}

      {/* One scroller for both sections, so the pinned tasks scroll away
          with the rest rather than holding half the column; in a phone's
          drawer the pages' rows ride it too. */}
      <Fill className="sidebar-section">
        <ScrollArea fade={SCROLL_FADE.BOTH}>
          <ListMotion root={body}>
            <div {...roving} ref={bodyRef} className="sidebar-section-body" {...motionRows()}>
              {narrow ? places : null}
              {operator === undefined ? null : (
                <nav className="sidebar-group" aria-label="Luke">
                  <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.ROW} className="sidebar-tasks">
                    <SidebarLuke
                      operator={operator}
                      agent={tasks.listedAgents.standing.find(
                        (agent) =>
                          agent.workspaceId === operator.workspaceId && isLuke(agent, operator),
                      )}
                      current={lukeId !== undefined && lukeId === agentShown}
                      unread={lukeId !== undefined && context.unseenAgent(lukeId)}
                      shown={tasks.shown && overlay.inSight}
                      onOpen={chosen(openAgent)}
                    />
                  </Stack>
                </nav>
              )}
              {/* While the account keeps sections Pinned stands empty too, a place to drop the first pin, for a mouse: a finger, which drags no row, draws it only once it holds one. */}
              {tasks.signedIn && (pinnedSection.length > 0 || (sectionsShown && !coarse)) ? (
                <PinnedSection
                  rows={pinnedSection}
                  folds={folds}
                  shown={pinnedShown}
                  context={context}
                  onOpenTab={chosen(openPinnedTab)}
                  onDropOut={sectionsShown ? dropPinned : undefined}
                />
              ) : null}
              {listsInbox && inboxListing !== undefined ? (
                <SidebarInbox
                  tasks={tasks}
                  listing={inboxListing}
                  shown={tasks.shown && overlay.inSight}
                  onOpen={chosen(openInboxItem)}
                />
              ) : (
                <>
                  <SidebarSections
                    sections={shownSections}
                    context={{
                      tasks,
                      dialogs: sectionDialogs,
                      current: currentRow,
                      unread,
                      inSight: overlay.inSight,
                      folded: folds.sectionFolded,
                      onToggle: folds.toggleSection,
                      row: (row) =>
                        row.kind === TASK_ROW.TASK ? (
                          <SidebarTask
                            key={row.task.id}
                            tasks={tasks}
                            task={row.task}
                            current={context.marked(row.task.id, undefined)}
                            open={current(row.task.id)}
                            unread={unread(row.task)}
                            now={now}
                            faces={context.faces}
                            onOpen={() => context.onOpen(row.task.id)}
                          />
                        ) : (
                          <SidebarAgent
                            key={row.agent.id}
                            agent={row.agent}
                            agents={tasks.agents}
                            current={currentRow(row)}
                            unread={context.unseenAgent(row.agent.id)}
                            now={now}
                            at={taskRowTime(row, context.order)}
                            face={context.faces.creator && context.faces.assignee}
                            shown={tasks.shown && overlay.inSight}
                            onOpen={() => context.onOpenAgent(row.agent.id)}
                            onPin={pinOf(tasks, row.agent)}
                            section={context.sectionEntry(row.agent)}
                            onDeleted={context.onDeletedAgent(row.agent.id)}
                          />
                        ),
                      onDropRow: dropRow,
                    }}
                  />
                  <nav
                    className="sidebar-group"
                    aria-label="Tasks"
                    data-row-drop={sectionsShown ? TASKS_DROP_ZONE : undefined}
                    {...motionRows()}
                  >
                    {tasks.signedIn ? (
                      <GroupHeader
                        heading={GROUP_HEADING.NONE}
                        label="Tasks"
                        actionsShown={GROUP_ACTIONS.AT_REST}
                        actions={
                          <>
                            {sectionsShown && tasks.workspace !== undefined ? (
                              <NewSectionButton
                                onNew={chosen(() => {
                                  const { workspace } = tasks;
                                  if (workspace !== undefined) sectionDialogs.askNew(workspace.id);
                                })}
                              />
                            ) : null}
                            <TaskStatusFilter
                              menu={statusMenu}
                              statuses={statuses}
                              onStatuses={taskView.onStatuses}
                            />
                            <TaskViewOptions
                              shown={tasks.shown && overlay.inSight}
                              control={taskView}
                              shared={shared}
                              filtered={createdBy !== undefined || assignedTo !== undefined}
                            />
                          </>
                        }
                      />
                    ) : null}
                    {tasks.signedIn ? (
                      <ViewChips
                        createdBy={createdBy}
                        assignedTo={assignedTo}
                        tasks={unpinnedTasks}
                        onClearCreatedBy={() => taskView.onCreatedBy(undefined)}
                        onClearAssignedTo={() => taskView.onAssignedTo(undefined)}
                      />
                    ) : null}
                    {(createdBy !== undefined || assignedTo !== undefined) &&
                    rows.length === 0 &&
                    !unlisted &&
                    tasks.listRead &&
                    !tasks.listFailed ? (
                      <NoteLine look={NOTE_LINE_LOOK.ROWS}>
                        {NONE_MATCH} <Button onClick={taskView.onEveryone}>Show all</Button>
                      </NoteLine>
                    ) : null}
                    {tasks.listFailed ? (
                      <ErrorState
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
                      sections={sections}
                      repositoryOf={repositoryOf}
                      folds={folds}
                      onNewTaskIn={chosen(newTaskIn)}
                      context={context}
                    />
                    <HiddenStatusesLine menu={statusMenu} hidden={hidden} />
                  </nav>
                </>
              )}
            </div>
          </ListMotion>
        </ScrollArea>
      </Fill>

      <ColumnFoot docked={!sidebar.collapsed}>
        <SidebarFoot
          account={account}
          updates={updates}
          shown={overlay.inSight}
          settingsOpen={tab === PANEL_TAB.SETTINGS}
          onSettings={chosen(() => onTabChange(PANEL_TAB.SETTINGS))}
          onSignOut={onSignOut}
        />
      </ColumnFoot>
      {sectionDialogs.dialog}
      {/* Last, so the drag strip above Luke does not take the edge's top from it. */}
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
