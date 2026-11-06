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
import { isAgentTab, sameTab } from "@repo/ui/tab-strip-model";
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

const WORK_RESERVE = 360;

const RUNNING_NOUN = "running";

const LIST_SKELETON = ["72%", "54%", "64%", "46%"] as const;

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

const UNNAMED_STEP = "Earlier page";

function historyGroups(
  steps: readonly HistoryStep[],
  onGoTo: (at: number) => void,
): (readonly MenuAction[])[] {
  const groups: MenuAction[][] = [];
  let page: HistoryPage | undefined;
  for (const step of steps) {
    const item: MenuAction = {
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
    <HoldPress
      mouse
      disabled={!able}
      onHold={openList}
      onKeyDown={(event) => {
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

interface RowContext {
  readonly tasks: TasksControl;
  readonly current: (taskId: string) => boolean;
  readonly marked: (taskId: string, pin: SidebarPin | undefined) => boolean;
  readonly markedPin: (pin: SidebarPin) => boolean;
  readonly onOpen: (taskId: string) => void;
  readonly currentRow: (row: TaskRow) => boolean;
  readonly onOpenAgent: (agentId: string) => void;
  readonly onDeletedAgent: (agentId: string) => () => void;
  readonly unread: (task: TaskSummary) => boolean;
  readonly unseenAgent: (agentId: string) => boolean;
  readonly now: number;
  readonly faces: RowFaces;
  readonly inSight: boolean;
  readonly dropOut: ((row: TaskRow, zone: string, at: number) => void) | undefined;
  readonly onCarried: (carried: boolean) => void;
  readonly sectionEntry: (agent: TasklessAgent) => MenuEntry | undefined;
  readonly childCount: (taskId: string) => ChildTaskCount | undefined;
  readonly opened: (taskId: string) => boolean;
  readonly onFoldTask: (taskId: string) => void;
  readonly runs: SidebarRunsPlace;
}

function nestedRows(
  rows: readonly TaskRow[],
  folds: FoldedGroups,
  current: (row: TaskRow) => boolean,
): TaskRow[] {
  return drawnTaskRows(rows, folds.taskOpened, current).map(({ row }) => row);
}

function repositoryGroupKey(group: RepositoryGroup): string {
  return group.repository ?? NO_REPOSITORY;
}

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

function pinOf(tasks: TasksControl, agent: TasklessAgent): ((pinned: boolean) => void) | undefined {
  return agent.archivedAt === undefined
    ? (pinned) => tasks.onPinAgent(agent.id, pinned)
    : undefined;
}

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

function pinnedRowKey(row: PinnedRow): string {
  const { pin } = row;
  if (pin === undefined) return row.kind === TASK_ROW.AGENT ? row.agent.id : row.task.id;
  return isAgentPin(pin) ? pin.tab.agent : String(pin.at);
}

function localPinOf(row: PinnedRow): PinnedTab | undefined {
  const { pin } = row;
  return pin === undefined || isAgentPin(pin) ? undefined : pin;
}

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

function agentPinOf(pin: TaskAgentPin, agent: AgentSummary, tasks: TasksControl): AgentPin {
  const drawn = {
    task: pin.taskId,
    tab: { agent: agent.id },
    label: agentName(agent, tasks.agents.models),
    at: pin.pinnedAt,
    model: agent.model,
  };
  return pin.pinPosition === undefined ? drawn : { ...drawn, position: pin.pinPosition };
}

const placeOf = (row: PinnedRow): PinPlace => row.place;

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

function movePinned(
  rows: readonly PinnedRow[],
  from: number,
  to: number,
  tasks: TasksControl,
): void {
  placePins(pinPositionsForMove(rows, from, to, placeOf), tasks);
}

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

function leaveSection(tasks: TasksControl, member: SectionMember): TaskSectionWrite[] {
  return memberSection(tasks.taskSections, member) === undefined ? [] : unplaceAllWrites([member]);
}

function pinnedHeld(rows: readonly PinnedRow[]): TaskRow[] {
  return rows.flatMap((row): TaskRow[] => {
    if (row.pin !== undefined) return [];
    return [row.kind === TASK_ROW.AGENT ? agentRow(row.agent) : taskRow(row.task)];
  });
}

type PinnedDrawn =
  | { readonly pin: PinnedRow; readonly held: DrawnTaskRow | undefined }
  | { readonly pin: undefined; readonly held: DrawnTaskRow };

function pinnedDrawnKey(drawn: PinnedDrawn): string {
  return drawn.pin === undefined ? taskRowKey(drawn.held.row) : pinnedRowKey(drawn.pin);
}

const depthOf = (drawn: PinnedDrawn) => ({ depth: drawn.held?.depth ?? 0 });

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

function pinSlot(drawn: readonly PinnedDrawn[], at: number): number {
  return drawn.slice(0, at).filter((each) => each.pin !== undefined).length;
}

function pinnedTaskRows(drawn: readonly PinnedDrawn[]): TaskRow[] {
  return drawn.flatMap(({ pin, held }): TaskRow[] => {
    if (pin === undefined) return [held.row];
    if (pin.pin !== undefined) return [];
    return [pin.kind === TASK_ROW.AGENT ? agentRow(pin.agent) : taskRow(pin.task)];
  });
}

function PinnedRows({
  rows,
  drawn: listed,
  context,
  onOpenTab,
  movable,
  onDropOut,
}: {
  rows: readonly PinnedRow[];
  drawn: readonly PinnedDrawn[];
  context: RowContext;
  onOpenTab: (pin: SidebarPin) => void;
  movable: boolean;
  onDropOut: ((row: PinnedRow, zone: string, at: number) => void) | undefined;
}): React.JSX.Element {
  const movePin = movable
    ? (from: number, to: number) => movePinned(rows, from, to, context.tasks)
    : undefined;
  const drawn = useLeaving(listed, pinnedDrawnKey);
  const keys = useMemo(() => drawn.map(({ key }) => key), [drawn]);
  const listedAt = new Map(listed.map((each, at) => [pinnedDrawnKey(each), at]));
  const fromListed = (from: number) => {
    const key = drawn[from]?.key;
    return key === undefined ? undefined : listedAt.get(key);
  };
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
  const pinPlaces = new Map(rows.map((row, at) => [pinnedRowKey(row), at]));
  const placeOf = (key: string) => {
    const at = pinPlaces.get(key);
    return movePin === undefined || at === undefined
      ? undefined
      : { at, count: rows.length, onMove: movePin };
  };
  const nests = nestsOf(drawn.map(({ value }) => depthOf(value)));
  return (
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
  adopted: readonly TaskRow[];
  folds: FoldedGroups;
  shown: (row: PinnedRow) => boolean;
  context: RowContext;
  onOpenTab: (pin: SidebarPin) => void;
  onDropOut: ((row: PinnedRow, zone: string, at: number) => void) | undefined;
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

const PIN_NOUN: CountNoun = { one: "pin", many: "pins" };

const PINNED_KEY = "pinned";

const PINNED_LISTED: readonly string[] = [PINNED_KEY];
const NOTHING_LISTED: readonly string[] = [];

function RepositorySection({
  group,
  label,
  folds,
  onNewTaskIn,
  context,
}: {
  group: RepositoryGroup;
  label: string;
  folds: FoldedGroups;
  onNewTaskIn: (repository: string) => void;
  context: RowContext;
}): React.JSX.Element {
  const { repository } = group;
  const folded = folds.folded(repository);
  const named = repository === null ? NO_REPOSITORY : label;
  const standing = group.rows.filter(context.currentRow);
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

type TaskSections =
  | {
      readonly grouping: typeof TASK_GROUPING.REPOSITORY;
      readonly groups: readonly RepositoryGroup[];
    }
  | { readonly grouping: typeof TASK_GROUPING.NONE; readonly rows: readonly TaskRow[] };

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

function taskSectionLists(sections: TaskSections): (readonly TaskRow[])[] {
  return sections.grouping === TASK_GROUPING.NONE
    ? [sections.rows]
    : sections.groups.map((group) => group.rows);
}

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

function homedSection(drawn: ShownSection, rows: readonly TaskRow[]): ShownSection {
  const kept = new Set(rows);
  const entries = drawn.entries.filter((_, at) => {
    const row = drawn.rows[at];
    return row !== undefined && kept.has(row);
  });
  return { ...drawn, entries, rows };
}

interface TaskOrderView {
  readonly workspaceId: string | undefined;
  readonly grouping: TaskSections["grouping"];
  readonly assignedTo: AssignedTo;
}

function assignedMember(assignedTo: AssignedTo): string | undefined {
  return assignedTo.kind === ASSIGNED_TO.MEMBER ? assignedTo.userId : undefined;
}

function sameTaskOrder(was: TaskOrderView, now: TaskOrderView): boolean {
  return (
    was.workspaceId === now.workspaceId &&
    was.grouping === now.grouping &&
    was.assignedTo.kind === now.assignedTo.kind &&
    assignedMember(was.assignedTo) === assignedMember(now.assignedTo)
  );
}

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

function groupOf(row: TaskRow, grouping: TaskSections["grouping"]): string | null | undefined {
  switch (grouping) {
    case TASK_GROUPING.REPOSITORY:
      return taskRowRepository(row);
    case TASK_GROUPING.NONE:
      return null;
  }
}

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

interface FloatingSidebar extends HoverPane {
  readonly inSight: boolean;
}

function sidebarFocus(sidebar: HTMLElement): HTMLElement | null {
  return (
    sidebar.querySelector<HTMLElement>('[aria-current="page"]') ??
    sidebar.querySelector<HTMLElement>(".sidebar-places > button")
  );
}

function useFloatingSidebar(sidebar: SidebarCollapse): FloatingSidebar {
  const pane = useHoverPane(
    { state: sidebar.overlay, onState: sidebar.onOverlay },
    { focusAt: sidebarFocus, stays: ".title-bar-controls" },
  );
  return { ...pane, inSight: sidebarInSight(sidebar) };
}

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

function SidebarTasksRow({
  current,
  disabled,
  onOpen,
  onPreload,
}: {
  current: boolean;
  disabled: boolean;
  onOpen: () => void;
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

function SidebarAutomationsRow({
  current,
  failed,
  running,
  disabled,
  onOpen,
}: {
  current: boolean;
  failed: boolean;
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
      onPointerEnter={onPreload}
      onClick={onOpen}
    >
      Admin
    </NavItem>
  );
}

interface SectionedTasks {
  readonly sections: readonly DrawnSection[];
  readonly taskIds: ReadonlySet<string>;
  readonly agentIds: ReadonlySet<string>;
}

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

interface DesktopSidebarProps {
  sidebar: SidebarCollapse;
  history: NavigationHistory;
  tasks: TasksControl;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  account: AccountSnapshot;
  updates: UpdateControl;
  onSignOut: () => Promise<void>;
  onPressWithin: () => void;
  room?: ShellRoom | undefined;
}

function NewTaskButton({
  tasks,
  shown,
  onNewTask,
}: {
  tasks: TasksControl;
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
  const [carrying, setCarrying] = useState(false);
  const [pointing, setPointing] = useState(false);
  const overlay = useFloatingSidebar(sidebar);
  useFirstUsableSpan(tasks);
  const body = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const runs = useVirtualRuns();
  const finding = useFindOpen();
  const runsPlace = useMemo(
    (): SidebarRunsPlace => ({ scroller, body, finding, holdRun: runs.hold }),
    [finding, runs.hold],
  );
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
  const inAdmin = tasks.adminView.open;
  const inInbox = onTasks && !inAdmin && tasks.inboxView.open;
  const inAutomations = onTasks && tasks.automationsView.open;
  const inBoard = onTasks && !inAdmin && tasks.boardView.open;
  const inPerson = onTasks && !inAdmin && tasks.personView.userId !== undefined;
  const { place: automationsPlace } = tasks.automationsView;
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
  const leaveRouted = () => onTabChange(PANEL_TAB.TASKS);
  const openTask = (taskId: string) => {
    leaveRouted();
    tasks.onResume(taskId);
  };
  const showTasks = () => {
    leaveRouted();
  };
  const newTask = () => {
    showTasks();
    tasks.onNewTask();
  };
  const openPinnedTab = (pin: SidebarPin) => {
    leaveRouted();
    tasks.onOpenPinnedTab(pin);
  };
  const openInbox = () => {
    leaveRouted();
    tasks.inboxView.onOpen();
  };
  const openBoard = () => tasks.boardView.onOpen();
  const openAutomations = () => tasks.automationsView.onOpen();
  const openAdmin = () => tasks.adminView.onOpen();
  const goHome = () => {
    leaveRouted();
    tasks.onGoHome();
  };
  const atHome = onTasks && !standingIn && tasks.page === TASKS_PAGE.HOME;
  const newTaskIn = (repository: string) => {
    leaveRouted();
    tasks.onNewTaskIn(repository);
  };
  const folds = useFoldedGroups(sidebar.staged);
  const taskView = useTaskListView(tasks.workspace?.id, sidebar.staged);
  const newSectionButton = useRef<HTMLButtonElement | null>(null);
  const reader = useMemberDirectory();
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
  const agentShown = onTasks && !inAdmin ? tasks.agentView.agentId : undefined;
  const currentRow = (row: TaskRow) =>
    row.kind === TASK_ROW.TASK ? current(row.task.id) : row.agent.id === agentShown;
  const openAgent = (agentId: string) => {
    leaveRouted();
    tasks.agentView.onOpen(agentId);
  };
  const { listed: listedRows, listedAgents } = tasks;
  const pinned = tasks.listed.tasks.filter((task) => task.pinnedAt !== undefined);
  const pinnedAgents = listedAgents.standing.filter((agent) => agent.pinnedAt !== undefined);
  const pinnedSection = pinnedRows(pinned, pinnedAgents, listedAgents.standing, tasks);
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
  const sectionsShown = tasks.signedIn && tasks.workspace !== undefined;
  const sectioned = sectionedTasks(
    tasks,
    sectionsShown ? tasks.workspace?.id : undefined,
    tasks.listed.tasks.filter((task) => task.pinnedAt === undefined),
    listedAgents.standing.filter((agent) => agent.pinnedAt === undefined),
  );
  const openParents = useMemo(
    () => openParentIds(tasks.listed.tasks, SHOWN_STATUSES),
    [tasks.listed.tasks],
  );
  const shownSections = sectioned.sections.map((drawn) =>
    sectionInView(drawn, openParents, assignedTo, tasks.me),
  );
  const sectionDialogs = useSectionDialogs(tasks, tasks.shown && overlay.inSight);
  const sectionEdits = useSectionEdits();
  const sectionSlot = (target: DrawnSection, at: number) =>
    folds.sectionFolded(target.section.id)
      ? at
      : storedSlot(target.rows, drawnTaskRows(target.rows, folds.taskOpened, currentRow), at);
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
  const mine: AssignedTo = { kind: ASSIGNED_TO.ME };
  const tasksHead = tasksHeadWords(assignedTo, shared, reader, tasks.listed.tasks);
  const askNewSection = () => {
    const { workspace } = tasks;
    if (workspace !== undefined) sectionEdits.beginCreate(workspace.id, newSectionButton.current);
  };
  const newSectionOffered = sectionsShown && tasks.workspace !== undefined;
  const childCounts = useMemo(() => childTaskCounts(tasks.listed.tasks), [tasks.listed.tasks]);
  const context: RowContext = {
    tasks,
    current,
    marked: (taskId, pin) =>
      markedPin === undefined ? pin === undefined && current(taskId) : pin === markedPin,
    markedPin: (pin) => pin === markedPin,
    onOpen: chosen(openTask),
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
      tasks.unreadTabs.some((tab) => isAgentTab(tab) && tab.agent === agentId),
    now,
    faces: { creator: true, assignee: assignedTo.kind !== ASSIGNED_TO.MEMBER },
    inSight: overlay.inSight,
    dropOut: sectionsShown ? dropRow : undefined,
    onCarried: setCarrying,
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
  const unpinnedTasks = withoutFinishedRunTasks(
    listedRows.tasks.filter(
      (task) => task.pinnedAt === undefined && !sectioned.taskIds.has(task.id),
    ),
    { unread, inbox: tasks.listed.inbox, shown: current },
  );
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
  const unlisted =
    listedRows.tasks.length === 0 &&
    pinnedAgents.length === 0 &&
    sectioned.agentIds.size === 0 &&
    unpinnedAgents.length === 0;
  const unpinned = [...unpinnedTasks.map(taskRow), ...unpinnedAgents.map(agentRow)];
  const rows = taskRowsAssignedTo(unpinned, assignedTo, tasks.me);
  const hidden = hiddenStatuses(rows, SHOWN_STATUSES, openParents);
  const statusRows = taskRowsInStatuses(rows, SHOWN_STATUSES, openParents);
  const orderView: TaskOrderView = {
    workspaceId: tasks.workspace?.id,
    grouping: taskView.view.grouping,
    assignedTo,
  };
  const placing = { grouping: orderView.grouping, pending: tasks.pendingTasks };
  const sections = useHeldOrder(orderView, tasks.shown && overlay.inSight && pointing, {
    sameOrder: sameTaskOrder,
    draw: (places: ReadonlyMap<string, TaskRow>) => {
      const placed = taskPlaces(statusRows, places, placing);
      const held = taskSections([...placed.values()], orderView.grouping, tasks);
      return liveSections(held, new Map(statusRows.map((row) => [taskRowKey(row), row])));
    },
    placesOf: (_drawn, held) => taskPlaces(statusRows, held, placing),
  });
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
  const chooseOrder = drawn.flatMap((row) => (row.kind === TASK_ROW.TASK ? [row.task.id] : []));
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

  const phone = room === SHELL_ROOM.NARROW;
  const places = (
    <>
      <SidebarPlaces>
        {phone ? null : (
          <>
            <NewTaskButton
              tasks={tasks}
              shown={
                tasks.newTask.open ||
                (atHome && tasks.signedIn && tasks.personView.userId === undefined)
              }
              onNewTask={chosen(newTask)}
            />
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
                >
                  <div
                    {...roving}
                    ref={bodyRef}
                    className="sidebar-section-body flex min-h-list-held flex-col p-ring-reach [&_.sidebar-group+.sidebar-group]:mt-section-gap"
                    {...motionRows()}
                  >
                    {places}
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
                      {tasks.listFailed && (connected || unlisted) ? (
                        <ErrorState
                          failure={unreadShown(FAILURE_SURFACE.TASKS_READ)}
                          onRetry={tasks.onRetryList}
                          placement={ERROR_STATE_PLACEMENT.ROWS}
                        >
                          Your tasks could not be read.
                        </ErrorState>
                      ) : null}
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
      {sidebar.collapsed ? null : <ResizeEdge edge={edge} />}
    </PanePin>
  );
}

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
