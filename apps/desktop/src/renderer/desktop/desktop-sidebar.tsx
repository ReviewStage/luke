import type { AccountSnapshot } from "@luke/credentials/snapshot";
import type { TasklessAgent } from "@luke/features/coding-agent-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import {
  inPinOrder,
  type PinPlace,
  pinPositionsForInsert,
  pinPositionsForMove,
} from "@luke/features/pin-order";
import { TASK_SECTION_WRITE, type TaskSectionWrite } from "@luke/features/task-section-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { EXPERIMENT } from "@luke/settings";
import { APP_COMMAND, APP_SHORTCUTS } from "@luke/settings/shortcuts";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BUTTON_SIZE,
  Button,
  ComposeIcon,
  EllipsisIcon,
  ErrorState,
  FolderIcon,
  IconButton,
  NAV_CURRENT,
  NavItem,
  PinIcon,
  PlusIcon,
  ProviderMark,
  SearchIcon,
  Skeleton,
  SkeletonRegion,
  UnpinIcon,
  useMenu,
} from "@luke/ui";
import { actorName, creatorActor } from "@luke/ui/actor-model";
import { forYou } from "@luke/ui/chat-model";
import { isAgentTab, sameTab } from "@luke/ui/tab-strip-model";
import {
  agentRow,
  type CreatorGroup,
  creatorGroups,
  orderTaskRows,
  type RepositoryGroup,
  repositoryGroups,
  repositoryLabel,
  TASK_GROUPING,
  TASK_ROW,
  type TaskOrder,
  type TaskRow,
  taskRow,
  taskRowRepository,
  taskRowsCreatedBy,
  taskRowTime,
} from "@luke/ui/task-list-model";
import {
  placeWrites,
  sectionEntries,
  sectionOrder,
  workspaceSections,
} from "@luke/ui/task-sections-model";
import { repositoryPageUrl, TASK_MARK, TASKS_PAGE } from "@luke/ui/tasks-model";
import type { UpdateControl } from "@luke/voice/settings-controls";
import {
  FactoryIcon,
  FolderPlusIcon,
  HouseIcon,
  InboxIcon,
  ListTodoIcon,
  MessagesSquareIcon,
  ZapIcon,
} from "lucide-react";
import { useRef } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref";
import { runAppCommand, useAppCommand } from "../app-commands";
import { type CallCardInput, ColumnFoot } from "../call/call-card";
import { LinkWorkspaceProvider } from "../copy-link-item";
import { MemberDirectory, useMemberDirectory } from "../member-directory";
import type { NavigationHistory } from "../navigation-history";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { RepositoryPicture } from "../repository-picture";
import { Shortcut } from "../shortcut";
import { GLYPH_STATE, stateEndMark } from "../state-glyph";
import { useChatOn } from "../tasks/chat-gate";
import { NEEDS_YOU } from "../tasks/inbox-model";
import { useMinute } from "../tasks/task-time";
import { inColumn, type PinnedTab } from "../tasks/use-side-panel";
import { useUnreadTasks } from "../tasks/use-task-looks";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab";
import { commandKeyshortcuts, Tooltip } from "../tooltip";
import { useExperiment } from "../use-app-state";
import { ActionMenu, type MenuAction } from "./action-menu";
import { useFailedRunsMark } from "./failed-runs";
import { type FoldedGroups, useFoldedGroups } from "./folded-groups";
import { type HoverPane, useHoverPane } from "./hover-pane";
import { LukeIdentity } from "./luke-identity";
import { SidebarAgent } from "./sidebar-agent";
import { SIDEBAR_WIDTH, type SidebarCollapse } from "./sidebar-collapse";
import { SidebarFoot } from "./sidebar-foot";
import { type CountNoun, SidebarGroupHeader } from "./sidebar-group-header";
import { SidebarPinnedTab } from "./sidebar-pinned-tab";
import {
  type DrawnSection,
  PINNED_DROP_ZONE,
  SidebarSections,
  TASKS_DROP_ZONE,
  useSectionDialogs,
} from "./sidebar-sections";
import {
  SidebarSectionHead,
  TaskViewOptions,
  useTaskViewCommands,
  ViewChips,
} from "./sidebar-task-view";
import { SidebarTask } from "./task-actions";
import { useArchivedView, useTaskListView } from "./task-list-view";
import { EDGE_SIDE, type ResizableEdgeProps, useResizableEdge } from "./use-resizable-edge";
import { useRowDrag } from "./use-row-drag";
import { WorkspaceSwitcher } from "./workspace-switcher";

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
): ResizableEdgeProps {
  return useResizableEdge({
    side: EDGE_SIDE.RIGHT,
    width: sidebar.width,
    bounds: SIDEBAR_WIDTH,
    reserve: () => WORK_RESERVE,
    label: "Resize sidebar",
    onResize: sidebar.onResize,
    onToggleCollapsed,
  });
}

/**
 * The left column's right edge, dragged to resize it; double-clicked, it goes
 * back to the default width.
 */
export function SidebarResizeEdge({ edge }: { edge: ResizableEdgeProps }): React.JSX.Element {
  return <div className="sidebar-resize" {...edge} />;
}

/**
 * Back and forward, at the right of the left column's title-bar row, level
 * with the traffic lights, the way Cursor and Codex keep them: in the
 * column, so they ride its right edge as it is dragged and slide away with
 * it when it folds, after the column's drag strip so they claim their
 * presses back from the window frame. A way with nothing along it is dimmed
 * rather than gone, so neither button moves. The chords are the shell's to
 * offer, since they answer while the column is folded too.
 */
export function HistoryButtons({ history }: { history: NavigationHistory }): React.JSX.Element {
  return (
    <div className="title-bar-controls" data-edge="column">
      <Tooltip label="Back" command={APP_COMMAND.BACK}>
        <IconButton
          icon={<ArrowLeftIcon />}
          label="Back"
          disabled={!history.canGoBack}
          onClick={history.onBack}
        />
      </Tooltip>
      <Tooltip label="Forward" command={APP_COMMAND.FORWARD}>
        <IconButton
          icon={<ArrowRightIcon />}
          label="Forward"
          disabled={!history.canGoForward}
          onClick={history.onForward}
        />
      </Tooltip>
    </div>
  );
}

/** What every row of the tasks is drawn with, whichever section it stands in. */
interface RowContext {
  readonly tasks: TasksControl;
  /** Whether a task is the one open, which a fold still leaves standing. */
  readonly current: (taskId: string) => boolean;
  /** Whether a row is the one the sidebar marks: the pin the open task was opened from, else the open task's own row. */
  readonly marked: (planId: string, pin: PinnedTab | undefined) => boolean;
  readonly onOpen: (planId: string) => void;
  /** Whether a row is the one standing: the open plan's, or the agent's whose page stands. */
  readonly currentRow: (row: TaskRow) => boolean;
  /** Opens an agent with no plan on its own page. */
  readonly onOpenAgent: (agentId: string) => void;
  /** Whether a task was saved since the developer last looked at it on this Mac. */
  readonly unread: (plan: TaskSummary) => boolean;
  /** Whether an agent's turn ended while the developer was not looking at it. */
  readonly unseenAgent: (agentId: string) => boolean;
  /** The time each row's last update is counted back from. */
  readonly now: number;
  /** The list's order, whose time each of its rows shows. */
  readonly order: TaskOrder;
  /** Whether the rows are the archived tasks, which no Archive is offered for. */
  readonly archived: boolean;
  /** Whether a teammate's task wears its creator's face: not while the list holds one creator's tasks. */
  readonly faces: boolean;
  /** Whether the sidebar is in sight: folded away, nothing it opened stands over the window. */
  readonly inSight: boolean;
  /** Hears a row let go over a section, Tasks, or Pinned, while the account keeps sections; none while it does not. */
  readonly dropOut: ((row: TaskRow, zone: string, at: number) => void) | undefined;
}

/**
 * One group's rows, each a plan's or an agent's with no plan, showing the
 * time the list's order chooses. A row says what its group does not: its
 * repository's name where `repository` names one, and a teammate's face
 * unless `face` is off, as under a group by creator.
 */
function TaskRows({
  rows,
  context,
  repository,
  face = context.faces,
}: {
  rows: readonly TaskRow[];
  context: RowContext;
  repository?: (row: TaskRow) => string | undefined;
  face?: boolean;
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
  return (
    <ul className="sidebar-tasks" onPointerDown={drag}>
      {rows.map((row) =>
        row.kind === TASK_ROW.TASK ? (
          <SidebarTask
            key={row.plan.id}
            tasks={context.tasks}
            task={row.plan}
            current={context.marked(row.plan.id, undefined)}
            open={context.current(row.plan.id)}
            unread={context.unread(row.plan)}
            now={context.now}
            at={taskRowTime(row, context.order)}
            repository={repository?.(row)}
            face={face}
            onOpen={() => context.onOpen(row.plan.id)}
          />
        ) : (
          <SidebarAgent
            key={row.agent.id}
            agent={row.agent}
            current={context.currentRow(row)}
            unread={context.unseenAgent(row.agent.id)}
            now={context.now}
            at={taskRowTime(row, context.order)}
            repository={repository?.(row)}
            face={face}
            shown={context.tasks.shown && context.inSight}
            onOpen={() => context.onOpenAgent(row.agent.id)}
            onPin={pinOf(context.tasks, row.agent)}
          />
        ),
      )}
    </ul>
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
      readonly plan: TaskSummary;
      readonly pin: PinnedTab | undefined;
      readonly place: PinPlace;
    }
  | {
      readonly kind: typeof TASK_ROW.AGENT;
      readonly agent: TasklessAgent;
      readonly place: PinPlace;
    };

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
    (plan): PinnedRow => ({
      kind: TASK_ROW.TASK,
      plan,
      pin: undefined,
      place: { position: plan.pinPosition, at: plan.pinnedAt ?? 0 },
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
    const plan = tasks.listed.tasks.find((each) => each.id === pin.task);
    return plan === undefined
      ? []
      : [{ kind: TASK_ROW.TASK, plan, pin, place: { position: pin.position, at: pin.at } }];
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
    if (row.pin === undefined) return [{ agent: false, id: row.plan.id, position }];
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
      : { kind: TASK_ROW.TASK, plan: row.plan, pin: undefined, place };
  if (row.kind === TASK_ROW.AGENT) tasks.onPinAgent(row.agent.id, true);
  else tasks.onMarkTask(row.plan.id, TASK_MARK.PIN);
  placePins(pinPositionsForInsert(rows, moving, at, placeOf), tasks);
}

/** Takes a row out of Pinned: a plan's or an agent's pin on the account, a tab's on this Mac. */
function unpin(row: PinnedRow, tasks: TasksControl): void {
  if (row.kind === TASK_ROW.AGENT) tasks.onPinAgent(row.agent.id, false);
  else if (row.pin === undefined) tasks.onMarkTask(row.plan.id, TASK_MARK.UNPIN);
  else tasks.sidePanel.onUnpin(row.pin.task, row.pin.tab);
}

/** The write that takes a task out of the section it is kept in, a pinned one's included; none where it is in none. */
function leaveSection(tasks: TasksControl, taskId: string): TaskSectionWrite[] {
  return sectionEntries(tasks.taskSections).has(taskId)
    ? [{ kind: TASK_SECTION_WRITE.PLACE, taskId, sectionId: null }]
    : [];
}

/** The rows of the list walked by ⌥↑ and ⌥↓ that Pinned holds: its plans and its agents, a pinned tab being its plan's. */
function pinnedTaskRows(rows: readonly PinnedRow[]): TaskRow[] {
  return rows.flatMap((row): TaskRow[] => {
    if (row.kind === TASK_ROW.AGENT) return [agentRow(row.agent)];
    return row.pin === undefined ? [taskRow(row.plan)] : [];
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
  const drag = useRowDrag(
    movable ? (from, to) => movePinned(rows, from, to, context.tasks) : undefined,
    {
      onDropOut:
        onDropOut === undefined
          ? undefined
          : (from, zone, at) => {
              const row = rows[from];
              if (row !== undefined) onDropOut(row, zone, at);
            },
    },
  );
  return (
    // An open Pinned keeps an order a row carried in lands at a place in; a folded one draws only some of its rows, so a drop lands on top.
    <ul
      className="sidebar-tasks"
      data-row-drop-rows={onDropOut !== undefined && movable ? "" : undefined}
      onPointerDown={drag}
    >
      {rows.map((row) => {
        if (row.kind === TASK_ROW.AGENT) {
          const { agent } = row;
          return (
            <SidebarAgent
              key={agent.id}
              agent={agent}
              current={context.currentRow(agentRow(agent))}
              unread={context.unseenAgent(agent.id)}
              now={context.now}
              at={agent.activityAt}
              shown={context.tasks.shown && context.inSight}
              onOpen={() => context.onOpenAgent(agent.id)}
              onPin={pinOf(context.tasks, agent)}
            />
          );
        }
        const { plan, pin } = row;
        return pin === undefined ? (
          <SidebarTask
            key={plan.id}
            tasks={context.tasks}
            task={plan}
            current={context.marked(plan.id, undefined)}
            open={context.current(plan.id)}
            unread={context.unread(plan)}
            now={context.now}
            onOpen={() => context.onOpen(plan.id)}
          />
        ) : (
          <SidebarPinnedTab
            key={String(pin.at)}
            tasks={context.tasks}
            pin={pin}
            task={plan}
            current={context.marked(plan.id, pin)}
            inSight={context.inSight}
            onOpen={() => onOpenTab(pin)}
            onOpenTask={() => context.onOpen(plan.id)}
          />
        );
      })}
    </ul>
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
  const drawn = folded ? rows.filter(shown) : rows;
  return (
    <nav
      className="sidebar-group"
      aria-label="Pinned"
      data-row-drop={onDropOut === undefined ? undefined : PINNED_DROP_ZONE}
    >
      <SidebarSectionHead
        name="Pinned"
        folded={folded}
        count={rows.length}
        noun={PIN_NOUN}
        onToggle={folds.togglePinned}
      />
      {drawn.length === 0 ? (
        folded ? null : (
          <p className="sidebar-section-empty">Drag tasks here to pin them</p>
        )
      ) : (
        <PinnedRows
          rows={drawn}
          context={context}
          onOpenTab={onOpenTab}
          movable={!folded}
          onDropOut={onDropOut}
        />
      )}
    </nav>
  );
}

/**
 * A repository's actions, offered alike from its header's ⋯ and from a
 * right-click on the header: Pin holds the group above the rest on the
 * account, Archive tasks puts every task under the header away, and Open on
 * GitHub opens the repository's page, under GitHub's mark rather than the
 * owner's picture, since it is about GitHub. The tasks with no repository
 * have no pin, since they always stand last, and no page to open. A group of
 * archived plans offers no Archive, since its plans are already away, so the
 * plans with no repository offer nothing there.
 */
function repositoryActionGroups(
  group: RepositoryGroup,
  tasks: TasksControl,
  archived: boolean,
): MenuAction[][] {
  const { repository } = group;
  // Note that only the group's plans are archived from here, because an agent is archived from its own page.
  const taskIds = group.rows.flatMap((row) => (row.kind === TASK_ROW.TASK ? [row.plan.id] : []));
  const archive: MenuAction[] =
    archived || taskIds.length === 0
      ? []
      : [
          {
            label: "Archive tasks",
            icon: <ArchiveIcon />,
            onSelect: () => tasks.onArchiveTasks(taskIds),
          },
        ];
  if (repository === null) return archive.length === 0 ? [] : [archive];
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
  return [[pin, ...archive], [github]];
}

/** Pinned holds tabs as well as tasks, so its count is read as pins. */
const PIN_NOUN: CountNoun = { one: "pin", many: "pins" };

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
  const rows = folded ? group.rows.filter(context.currentRow) : group.rows;
  // The menu is drawn over the window rather than inside the sidebar, so it
  // closes with the sidebar folding away as well as with the tab hiding.
  const menu = useMenu(context.tasks.shown && context.inSight);
  const ellipsis = useRef<HTMLButtonElement | null>(null);
  const actionGroups = repositoryActionGroups(group, context.tasks, context.archived);
  return (
    <div className="sidebar-repository">
      <SidebarGroupHeader
        glyph={
          repository === null ? (
            <FolderIcon />
          ) : (
            <RepositoryPicture
              repository={repository}
              pictures={context.tasks.repositories.pictures}
              fallback={<FolderIcon />}
            />
          )
        }
        name={named}
        folded={folded}
        count={group.rows.length}
        trailing={
          repository !== null && context.tasks.pinnedRepositories.includes(repository) ? (
            <span className="sidebar-repository-pinned">
              <PinIcon />
              <span className="luke-visually-hidden">(pinned)</span>
            </span>
          ) : null
        }
        tooltip={repository === null || label === repository ? undefined : repository}
        menuOpen={menu.open !== undefined}
        onContextMenu={actionGroups.length === 0 ? undefined : menu.contextMenu(ellipsis)}
        onToggle={() => folds.toggle(repository)}
        actions={
          <>
            {actionGroups.length === 0 ? null : (
              <Tooltip label="Repository actions">
                <IconButton
                  ref={ellipsis}
                  icon={<EllipsisIcon />}
                  label={`Actions for ${named}`}
                  size={BUTTON_SIZE.COMPACT}
                  {...menu.trigger()}
                />
              </Tooltip>
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
      />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${named} actions`}
          menu={menu.drawn}
          groups={actionGroups}
          onClose={menu.close}
        />
      )}
      {rows.length === 0 ? null : <TaskRows rows={rows} context={context} />}
    </div>
  );
}

/**
 * One creator's tasks under a header naming them by face, the reader's own
 * as You, a former member's on the quiet outline, folded and kept as a
 * repository's group is. The face is the group's to say, so the rows wear
 * none, and name no repository either, which the row's card names.
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
  const rows = folded ? group.rows.filter(context.currentRow) : group.rows;
  return (
    <div className="sidebar-repository">
      <SidebarGroupHeader
        glyph={<ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />}
        name={actorName(actor)}
        folded={folded}
        count={group.rows.length}
        onToggle={() => folds.toggleCreator(group.creatorId)}
      />
      {rows.length === 0 ? null : <TaskRows rows={rows} context={context} face={false} />}
    </div>
  );
}

/** Who created a row, as its creator's face and name are read: a task's creator and owner, or whoever started the agent. */
function creatorOf(row: TaskRow): Pick<TaskSummary, "createdBy" | "ownerId"> {
  if (row.kind === TASK_ROW.TASK) return row.plan;
  const { startedBy } = row.agent;
  return startedBy === undefined ? {} : { createdBy: startedBy, ownerId: startedBy.userId };
}

/** The listed tasks as the view groups them: by repository, by creator, or in one run. */
type TaskSections =
  | {
      readonly grouping: typeof TASK_GROUPING.REPOSITORY;
      readonly groups: readonly RepositoryGroup[];
    }
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
): TaskSections {
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
    case TASK_GROUPING.CREATOR:
      return sections.groups.flatMap((group) =>
        under(folds.creatorFolded(group.creatorId), group.rows),
      );
    case TASK_GROUPING.NONE:
      return [...sections.rows];
  }
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
        <>
          {sections.groups.map((group) => (
            <RepositorySection
              key={group.repository ?? NO_REPOSITORY}
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
          ))}
        </>
      );
    case TASK_GROUPING.CREATOR:
      return (
        <>
          {sections.groups.map((group) => (
            <CreatorSection
              key={group.creatorId ?? NO_REPOSITORY}
              group={group}
              folds={folds}
              context={context}
            />
          ))}
        </>
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
 * How many items wait on the developer: those of the listed workspace's
 * tasks, the sum of the Inbox's row counts, and every one from an agent
 * with no task, which names no workspace to be counted in.
 */
function waitingItems(tasks: TasksControl): number {
  return tasks.listed.inbox.reduce(
    (sum, task) => sum + task.items.length,
    tasks.inboxTaskless.length,
  );
}

/**
 * The home page's row, between Search and the Inbox and drawn as they are:
 * the house, its name, and its chord at its end while the row is hovered or
 * reached from the keyboard. A press goes to the home page from wherever the
 * window stands, and the row is the place shown while the home page is.
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
 * The Inbox's row, last of the rows heading the list and drawn as they are:
 * the tray, its name, and how many items wait on the developer across every
 * task at its end, the sum of the counts the Inbox's rows show, muted in
 * even figures as a group's count is, and nothing at none. Its chord takes the count's place while the row is hovered or
 * reached from the keyboard, as New task's and Search's show theirs. A press
 * opens the window's Inbox (`desktop-inbox.tsx`), and the row is the place
 * shown while it stands.
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
        noun: waiting === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many,
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

/** How many messages wait on the developer in Chat: what For you lists. */
function waitingMessages(tasks: TasksControl): number {
  const read = tasks.chatView.chat;
  return read === undefined ? 0 : forYou(read.answer).length;
}

/**
 * Chat's row, under the Inbox's and drawn as it is: the glyph, its name, and
 * how many messages wait on the developer in For you at its end, in the
 * Inbox's muted figures, nothing at none. A press opens the window's Chat
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
      count={{ value: waiting, noun: "waiting on you" }}
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
  return { ...pane, inSight: !sidebar.collapsed || pane.floating };
}

/**
 * Factory's row, after the Inbox's and drawn as it is: the factory and its
 * name, with no chord, since Factory keeps none while it is an experiment
 * (⌘K reaches it). A press opens the window's Factory (`desktop-factory.tsx`),
 * and the row is the place shown while it stands.
 */
function SidebarFactoryRow({
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
      icon={<FactoryIcon />}
      current={current ? NAV_CURRENT.PAGE : undefined}
      disabled={disabled}
      onClick={onOpen}
    >
      Factory
    </NavItem>
  );
}

/**
 * The Issues page's row, after the Automations page's and drawn as it is:
 * its glyph, its name, and its chord. A press opens the window's Issues page
 * (`issues-page.tsx`), and the row is the place shown while it stands.
 */
function SidebarIssuesRow({
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
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.ISSUES)}
      shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.ISSUES].chord} />}
      disabled={disabled}
      onClick={onOpen}
    >
      Issues
    </NavItem>
  );
}

/**
 * The Automations page's row, after Factory's and drawn as it is: the
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

/** The listed workspace's sections as the sidebar draws them, and the tasks standing in any of them, which Tasks leaves out. */
interface SectionedTasks {
  readonly sections: readonly DrawnSection[];
  readonly taskIds: ReadonlySet<string>;
}

/**
 * The account's sections in the workspace, each with the tasks of `free`,
 * the listed tasks no pin holds, it keeps, in its order. A task in a
 * section that stands elsewhere, pinned or archived, is no row of it,
 * and comes back to it once it stands free again. None while the account
 * keeps no sections here.
 */
function sectionedTasks(
  tasks: TasksControl,
  workspaceId: string | undefined,
  free: readonly TaskSummary[],
): SectionedTasks {
  if (workspaceId === undefined) return { sections: [], taskIds: new Set() };
  const state = tasks.taskSections;
  const byId = new Map(free.map((plan) => [plan.id, plan]));
  const sections = workspaceSections(state, workspaceId).map((section): DrawnSection => {
    const entries = sectionOrder(state, section.id).filter((entry) => byId.has(entry.taskId));
    const held = entries.flatMap((entry) => byId.get(entry.taskId) ?? []);
    return { section, entries, tasks: held };
  });
  const standing = new Set(sections.map((drawn) => drawn.section.id));
  const taskIds = new Set(
    [...sectionEntries(state).values()]
      .filter((entry) => standing.has(entry.sectionId) && byId.has(entry.taskId))
      .map((entry) => entry.taskId),
  );
  return { sections, taskIds };
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
  /** Signs the account out, once the account menu's Log out is answered. */
  onSignOut: () => Promise<void>;
  /** The call card, at the column's foot above the account row, while one is to be drawn here. */
  call: CallCardInput | undefined;
  /** Hears every press in the sidebar, which a press outside it would put away while it floats. */
  onPressWithin: () => void;
}

/**
 * New task, heading the list: a press opens the New task dialog at once, as
 * the menu bar's and the chord's New task do, whose name field also
 * searches the workspace's Linear issues where Linear is connected
 * (`new-task-dialog.tsx`).
 */
function NewTaskButton({
  tasks,
  onNewTask,
}: {
  tasks: TasksControl;
  onNewTask: () => void;
}): React.JSX.Element {
  return (
    <NavItem
      icon={<ComposeIcon />}
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
 * The window's left column: at its head the workspace chosen, by its tile
 * and name and who shares it, with the menu that chooses another
 * (`workspace-switcher.tsx`), or Luke while no workspace is read; the way to
 * a new task, Search, which opens the command palette, every task of the
 * workspace chosen, and the account's
 * row, whose menu and gear lead to Settings and the rest. Home's row, the
 * Inbox's, and Factory's follow Search above the rule: Home's goes to the
 * home page, the Inbox's counts what waits on the developer and opens the
 * window's Inbox, and Factory's, while its experiment is on, opens the
 * window's Factory, and the Automations page's likewise opens it; Chat's, where
 * a chat is read, counts what waits on the developer in Chat and opens it. The pinned tasks, and the side panel tabs
 * pinned to the sidebar, stand in the Pinned section while any are pinned,
 * newest pinned first, under a head that folds it, every row one line whose
 * hover card says the rest; whatever the list's view says, they stand as
 * pinned. The rest stand in the Tasks section, grouped and ordered as its
 * View options say and the workspace keeps on this Mac
 * (`task-list-view.ts`): under their repositories' headers by default, the
 * pinned repositories first, newest pinned first, then the group updated
 * most recently first; under their creators'; or in one run. The archived
 * ones stand in the list's place while View options' Archived tasks is
 * chosen, until its chip's × or another workspace turns it back.
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
  call,
  onPressWithin,
}: DesktopSidebarProps): React.JSX.Element {
  const onTasks = tab === PANEL_TAB.TASKS;
  const overlay = useFloatingSidebar(sidebar);
  // The window's Inbox, an agent's page, Factory, the Automations page, Chat, and the Issues page stand in the task's place, so while one does no task is the place shown.
  const inInbox = onTasks && tasks.inboxView.open;
  const inFactory = onTasks && tasks.factoryView.open;
  const inAutomations = onTasks && tasks.automationsView.open;
  const inChat = onTasks && tasks.chatView.open;
  const inIssues = onTasks && tasks.issuesView.open;
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
    inFactory ||
    inAutomations ||
    inChat ||
    inIssues ||
    (onTasks && tasks.agentView.agentId !== undefined);
  // Factory, the Automations page, Chat, and the Issues page are experiments: each row stands only while the account has it on.
  const chatOn = useChatOn();
  const factoryOn = useExperiment(EXPERIMENT.FACTORY);
  const automationsOn = useExperiment(EXPERIMENT.AUTOMATIONS);
  const issuesOn = useExperiment(EXPERIMENT.ISSUES);
  const sectionsOn = useExperiment(EXPERIMENT.SECTIONS);
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
  const openInbox = () => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
    tasks.inboxView.onOpen();
  };
  const openFactory = () => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
    tasks.factoryView.onOpen();
  };
  const openIssues = () => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
    tasks.issuesView.onOpen();
  };
  const openAutomations = () => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
    tasks.automationsView.onOpen();
  };
  const openChat = () => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
    tasks.chatView.onOpen();
  };
  const goHome = () => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
    tasks.onGoHome();
  };
  // The home page is the place shown while no task is open, the Inbox is not
  // standing in its place, and no launch is still reopening a task.
  const atHome = onTasks && !standingIn && tasks.page === TASKS_PAGE.HOME && !tasks.restoring;
  const newTaskIn = (repository: string) => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
    tasks.onNewTaskIn(repository);
  };
  const folds = useFoldedGroups(sidebar.staged);
  const taskView = useTaskListView(tasks.workspace?.id, sidebar.staged);
  const reader = useMemberDirectory();
  // Only a workspace somebody shares has creators to group and filter by.
  const { memberCount } = tasks.workspace ?? {};
  const shared = memberCount === undefined ? (reader.members?.length ?? 0) > 1 : memberCount > 1;
  const createdBy = shared ? taskView.view.createdBy : undefined;
  const archive = useArchivedView(tasks.workspace?.id, sidebar.staged);
  useTaskViewCommands({
    offered: tasks.signedIn && tasks.workspace !== undefined,
    control: taskView,
    shared,
    readerId: tasks.me,
    archive,
  });
  const unread = useUnreadTasks([...tasks.tasks, ...tasks.archived], {
    listRead: tasks.listRead,
    staged: sidebar.staged,
  });
  const now = useMinute();
  const edge = useSidebarEdge(sidebar, sidebar.onToggle);
  const current = (planId: string) => onTasks && !standingIn && planId === tasks.activeTaskId;
  // An agent with no plan stands on its own page, which is the place shown while it stands.
  const agentShown = onTasks ? tasks.agentView.agentId : undefined;
  const currentRow = (row: TaskRow) =>
    row.kind === TASK_ROW.TASK ? current(row.plan.id) : row.agent.id === agentShown;
  const openAgent = (agentId: string) => {
    if (!onTasks) onTabChange(PANEL_TAB.TASKS);
    tasks.agentView.onOpen(agentId);
  };
  // The list is the chosen workspace's; the unread marks above read every task.
  const { listed: listedRows, listedAgents } = tasks;
  const unlisted =
    listedRows.tasks.length === 0 &&
    listedRows.archived.length === 0 &&
    listedAgents.standing.length === 0 &&
    listedAgents.archived.length === 0;
  const pinned = tasks.listed.tasks.filter((plan) => plan.pinnedAt !== undefined);
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
      current(row.plan.id) &&
      row.pin.task === chosenPin.task &&
      row.pin.at === chosenPin.at,
  );
  const markedPin = pinMarked?.kind === TASK_ROW.TASK ? pinMarked.pin : undefined;
  // The account's own sections stand while its experiment is on, a workspace is listed, and the archived tasks are not shown.
  const sectionsShown =
    sectionsOn && tasks.signedIn && tasks.workspace !== undefined && !archive.shown;
  const sectioned = sectionedTasks(
    tasks,
    sectionsShown ? tasks.workspace?.id : undefined,
    tasks.listed.tasks.filter((plan) => plan.pinnedAt === undefined),
  );
  const sectionDialogs = useSectionDialogs(tasks, tasks.shown && overlay.inSight);
  // Note that the sidebar draws a task in one place, so a row dragged into
  // Pinned leaves its section, and one dragged out of Pinned is unpinned and
  // stands where it was let go, under Tasks or in a section.
  const dropRow = (row: TaskRow, zone: string, at: number) => {
    if (zone === PINNED_DROP_ZONE) {
      if (row.kind === TASK_ROW.TASK) tasks.onWriteSections(leaveSection(tasks, row.plan.id));
      pinAt(pinnedSection, row, at, tasks);
      return;
    }
    if (row.kind !== TASK_ROW.TASK) return;
    const taskId = row.plan.id;
    if (zone === TASKS_DROP_ZONE) {
      if (!sectioned.taskIds.has(taskId)) return;
      tasks.onWriteSections([{ kind: TASK_SECTION_WRITE.PLACE, taskId, sectionId: null }]);
      return;
    }
    const target = sectioned.sections.find((drawn) => drawn.section.id === zone);
    if (target === undefined) return;
    tasks.onWriteSections(placeWrites(target.entries, taskId, zone, at, Date.now()));
  };
  const dropTask = (taskId: string, zone: string, at: number) => {
    const plan = tasks.listed.tasks.find((each) => each.id === taskId);
    if (plan !== undefined) dropRow(taskRow(plan), zone, at);
  };
  // A tab pinned to the sidebar is no task, so it goes into no section, though Tasks unpins it as any pin.
  const dropPinned = (row: PinnedRow, zone: string, at: number) => {
    const plan = row.kind === TASK_ROW.TASK && row.pin === undefined ? row.plan : undefined;
    if (zone === TASKS_DROP_ZONE) {
      unpin(row, tasks);
      if (plan !== undefined) tasks.onWriteSections(leaveSection(tasks, plan.id));
      return;
    }
    const target = sectioned.sections.find((drawn) => drawn.section.id === zone);
    if (target === undefined || plan === undefined) return;
    unpin(row, tasks);
    tasks.onWriteSections([
      ...leaveSection(tasks, plan.id),
      ...placeWrites(target.entries, plan.id, zone, at, Date.now()),
    ]);
  };
  const { chosen } = overlay;
  const context: RowContext = {
    tasks,
    current,
    marked: (planId, pin) =>
      markedPin === undefined ? pin === undefined && current(planId) : pin === markedPin,
    onOpen: chosen(openTask),
    currentRow,
    onOpenAgent: chosen(openAgent),
    unread,
    unseenAgent: (agentId) =>
      tasks.unreadTabs.some((tab) => isAgentTab(tab) && tab.agent === agentId),
    now,
    order: taskView.view.order,
    faces: createdBy === undefined,
    archived: archive.shown,
    inSight: overlay.inSight,
    dropOut: sectionsShown ? dropRow : undefined,
  };
  // A pinned tab is on show where its task is open and its column shows it:
  // an agent's or the Inbox in the task's own column, any other in the side panel. The
  // pin marked stands too, so a fold never hides the row the sidebar marks, and so
  // does a pinned agent while its page stands.
  const pinnedShown = (row: PinnedRow) => {
    if (row.kind === TASK_ROW.AGENT) return row.agent.id === agentShown;
    const { plan, pin } = row;
    return (
      (pin !== undefined && pin === markedPin) ||
      (current(plan.id) &&
        (pin === undefined ||
          (inColumn(pin.tab)
            ? sameTab(tasks.mainTabs.tab, pin.tab)
            : tasks.sidePanel.open &&
              tasks.sidePanel.tab !== undefined &&
              sameTab(tasks.sidePanel.tab, pin.tab))))
    );
  };
  // Note that the pins are never filtered, because a pin is already the
  // reader's own choice, and stand aside while the archived tasks are shown.
  // The agents with no plan stand among the plans, the archived ones among the archived.
  const unpinnedTasks = archive.shown
    ? listedRows.archived
    : listedRows.tasks.filter(
        (plan) => plan.pinnedAt === undefined && !sectioned.taskIds.has(plan.id),
      );
  const unpinnedAgents = archive.shown
    ? listedAgents.archived
    : listedAgents.standing.filter((agent) => agent.pinnedAt === undefined);
  const unpinned = [...unpinnedTasks.map(taskRow), ...unpinnedAgents.map(agentRow)];
  const rows = taskRowsCreatedBy(unpinned, createdBy);
  const { grouping, order } = taskView.view;
  const sections = taskSections(
    rows,
    grouping === TASK_GROUPING.CREATOR && !shared ? TASK_GROUPING.REPOSITORY : grouping,
    order,
    tasks,
    // A creator's group is ordered by the name its header says.
    (row) => actorName(creatorActor(creatorOf(row), reader, undefined)),
  );
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
  const sectionsDrawn = sectioned.sections.flatMap(({ section, tasks: held }) =>
    (folds.sectionFolded(section.id) ? held.filter((plan) => current(plan.id)) : held).map(taskRow),
  );
  const drawn = [
    ...(archive.shown ? [] : folds.pinnedFolded ? pinnedDrawn.filter(currentRow) : pinnedDrawn),
    ...sectionsDrawn,
    ...drawnTasks(sections, folds, currentRow),
  ];
  // Moving up and down the list as it reads: down from the home page, where
  // no row is open, is the first row. The ends go no further.
  const at = drawn.findIndex((row) =>
    agentShown === undefined
      ? row.kind === TASK_ROW.TASK && row.plan.id === tasks.activeTaskId
      : row.kind === TASK_ROW.AGENT && row.agent.id === agentShown,
  );
  const step = (by: number) => {
    const row = drawn[at + by];
    if (row === undefined) return;
    if (row.kind === TASK_ROW.TASK) openTask(row.plan.id);
    else openAgent(row.agent.id);
  };
  const listed = tasks.signedIn && drawn.length > 0;
  useAppCommand(APP_COMMAND.PREVIOUS_TASK, listed && at > 0 ? () => step(-1) : undefined);
  useAppCommand(APP_COMMAND.NEXT_TASK, listed && at < drawn.length - 1 ? () => step(1) : undefined);

  return (
    <aside
      ref={overlay.ref}
      className="desktop-sidebar"
      inert={!overlay.inSight}
      onPointerDown={onPressWithin}
      onPointerLeave={overlay.onPointerLeave}
      onKeyDown={overlay.onKeyDown}
    >
      <div className="desktop-drag-strip" />
      <HistoryButtons history={history} />
      {/* The workspace heads the sidebar once one is read, as everything under it is that
          workspace's; Luke's own head stands until then. */}
      {tasks.signedIn && tasks.workspace !== undefined ? (
        <WorkspaceSwitcher tasks={tasks} inSight={overlay.inSight} />
      ) : (
        <LukeIdentity />
      )}

      <div className="sidebar-places">
        <NewTaskButton tasks={tasks} onNewTask={chosen(newTask)} />
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
          waiting={tasks.signedIn ? waitingItems(tasks) : 0}
          current={inInbox}
          disabled={!tasks.signedIn}
          onOpen={chosen(openInbox)}
        />
        {/* Chat's row stands while the account has it on wherever there is a chat to read: a signed-in run, or a fixture's staged one. */}
        {chatOn && tasks.signedIn && tasks.chatView.available ? (
          <SidebarChatRow
            waiting={waitingMessages(tasks)}
            current={inChat}
            onOpen={chosen(openChat)}
          />
        ) : null}
        {factoryOn ? (
          <SidebarFactoryRow
            current={inFactory}
            disabled={!tasks.signedIn}
            onOpen={chosen(openFactory)}
          />
        ) : null}
        {automationsOn ? (
          <SidebarAutomationsRow
            current={inAutomations}
            failed={automationFailed}
            disabled={!tasks.signedIn}
            onOpen={chosen(openAutomations)}
          />
        ) : null}
        {issuesOn ? (
          <SidebarIssuesRow
            current={inIssues}
            disabled={!tasks.signedIn}
            onOpen={chosen(openIssues)}
          />
        ) : null}
      </div>
      <hr className="sidebar-rule" />

      {/* One scroller for both sections, so the pinned tasks scroll away
          with the rest rather than holding half the column. */}
      <div className="sidebar-section scroll-fade">
        {/* While the account keeps sections Pinned stands empty too, a place to drop the first pin. */}
        {tasks.signedIn && (pinnedSection.length > 0 || sectionsShown) && !archive.shown ? (
          <PinnedSection
            rows={pinnedSection}
            folds={folds}
            shown={pinnedShown}
            context={context}
            onOpenTab={chosen(openPinnedTab)}
            onDropOut={sectionsShown ? dropPinned : undefined}
          />
        ) : null}
        {sectioned.sections.length > 0 ? (
          <SidebarSections
            sections={sectioned.sections}
            context={{
              tasks,
              dialogs: sectionDialogs,
              current,
              inSight: overlay.inSight,
              folded: folds.sectionFolded,
              onToggle: folds.toggleSection,
              row: (plan) => (
                <SidebarTask
                  key={plan.id}
                  tasks={tasks}
                  task={plan}
                  current={context.marked(plan.id, undefined)}
                  open={current(plan.id)}
                  unread={unread(plan)}
                  now={now}
                  face={context.faces}
                  onOpen={() => context.onOpen(plan.id)}
                />
              ),
              onDropTask: dropTask,
            }}
          />
        ) : null}
        <nav
          className="sidebar-group"
          aria-label={archive.shown ? "Archived tasks" : "Tasks"}
          data-row-drop={sectionsShown ? TASKS_DROP_ZONE : undefined}
        >
          {tasks.signedIn ? (
            <SidebarSectionHead name={archive.shown ? "Archived tasks" : "Tasks"}>
              {sectionsShown && tasks.workspace !== undefined ? (
                <NewSectionButton
                  onNew={chosen(() => {
                    const { workspace } = tasks;
                    if (workspace !== undefined) sectionDialogs.askNew(workspace.id);
                  })}
                />
              ) : null}
              <TaskViewOptions
                shown={tasks.shown && overlay.inSight}
                control={taskView}
                shared={shared}
                archive={archive}
                filtered={createdBy !== undefined || archive.shown}
              />
            </SidebarSectionHead>
          ) : null}
          {tasks.signedIn ? (
            <ViewChips
              createdBy={createdBy}
              tasks={unpinnedTasks}
              onClearCreatedBy={() => taskView.onCreatedBy(undefined)}
              archive={archive}
            />
          ) : null}
          {archive.shown && unpinned.length === 0 && tasks.listRead && !tasks.listFailed ? (
            <p className="sidebar-note">No archived tasks.</p>
          ) : null}
          {createdBy !== undefined &&
          rows.length === 0 &&
          !unlisted &&
          !(archive.shown && unpinned.length === 0) &&
          tasks.listRead &&
          !tasks.listFailed ? (
            <p className="sidebar-note">
              {createdBy === tasks.me ? "None of your tasks here." : "None of their tasks here."}{" "}
              <Button onClick={() => taskView.onCreatedBy(undefined)}>Show all</Button>
            </p>
          ) : null}
          {tasks.listFailed ? (
            <div className="sidebar-note sidebar-failure">
              <ErrorState onRetry={tasks.onRetryList}>Your tasks could not be read.</ErrorState>
            </div>
          ) : null}
          {/* The list is empty before its first read lands, so that it
              holds none says nothing until the service has answered. */}
          {tasks.signedIn && unlisted && !tasks.listRead && !tasks.listFailed ? (
            <ListSkeleton />
          ) : null}
          {tasks.signedIn && unlisted && tasks.listRead && !tasks.listFailed && !archive.shown ? (
            <p className="sidebar-note">No tasks yet.</p>
          ) : null}
          {/* Every task and agent archived, the list would stand empty with no word of where they went. */}
          {tasks.signedIn &&
          !archive.shown &&
          tasks.listRead &&
          !tasks.listFailed &&
          tasks.listed.tasks.length === 0 &&
          listedAgents.standing.length === 0 &&
          (tasks.listed.archived.length > 0 || listedAgents.archived.length > 0) ? (
            <p className="sidebar-note">
              Every task is archived.{" "}
              <Button onClick={() => archive.onShown(true)}>Show archived</Button>
            </p>
          ) : null}
          {tasks.signedIn ? null : <p className="sidebar-note">Sign in to start a task.</p>}
          <TaskGroups
            sections={sections}
            repositoryOf={repositoryOf}
            folds={folds}
            onNewTaskIn={chosen(newTaskIn)}
            context={context}
          />
        </nav>
      </div>

      <ColumnFoot call={call}>
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
      {sidebar.collapsed ? null : <SidebarResizeEdge edge={edge} />}
    </aside>
  );
}

/**
 * The sidebar, read against the listed workspace's members: a teammate's
 * face on a row, a creator's group's header, and the order of those groups
 * by the names their headers say. Its links are written under that
 * workspace, which is every row's.
 */
export function DesktopSidebar(props: DesktopSidebarProps): React.JSX.Element {
  const { workspace } = props.tasks;
  return (
    <LinkWorkspaceProvider value={workspace?.slug ?? workspace?.id}>
      <MemberDirectory workspace={workspace} readerId={props.tasks.me}>
        <SidebarColumn {...props} />
      </MemberDirectory>
    </LinkWorkspaceProvider>
  );
}
