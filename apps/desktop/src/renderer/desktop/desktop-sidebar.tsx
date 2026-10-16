import type { AccountSnapshot } from "@luke/credentials/snapshot";
import type { TasklessAgent } from "@luke/features/coding-agent-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { EXPERIMENT } from "@luke/settings";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ComposeIcon,
  EllipsisIcon,
  FolderIcon,
  PinIcon,
  PlusIcon,
  ProviderMark,
  SearchIcon,
  UnpinIcon,
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
import { repositoryPageUrl, TASKS_PAGE } from "@luke/ui/tasks-model";
import type { UpdateControl } from "@luke/voice/settings-controls";
import { FactoryIcon, HouseIcon, InboxIcon, MessagesSquareIcon, ZapIcon } from "lucide-react";
import { useRef, useState } from "react";
import { APP_COMMAND, APP_SHORTCUTS } from "#shared/shortcuts";
import { ACTOR_SIZE, ActorMark } from "../actor-ref";
import { runAppCommand, useAppCommand } from "../app-commands";
import { type CallCardInput, ColumnFoot } from "../call/call-card";
import { LinkWorkspaceProvider } from "../copy-link-item";
import { MemberDirectory, useMemberDirectory } from "../member-directory";
import type { NavigationHistory } from "../navigation-history";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { NEEDS_YOU } from "../planning/inbox-model";
import { LinearIssuePicker } from "../planning/linear-issue-picker";
import { useMinute } from "../planning/plan-time";
import { useUnreadPlans } from "../planning/use-plan-looks";
import { AUTOMATIONS_PAGE, type PlansControl } from "../planning/use-plans-tab";
import { inColumn, type PinnedTab } from "../planning/use-side-panel";
import { ReadFailure } from "../read-failure";
import { RepositoryPicture } from "../repository-picture";
import { Shortcut } from "../shortcut";
import { Skeleton, SkeletonRegion } from "../skeleton";
import { GLYPH_STATE, stateEndMark } from "../state-glyph";
import { commandKeyshortcuts, Tooltip } from "../tooltip";
import { useExperiment } from "../use-app-state";
import { ActionMenu, type MenuAction, useActionMenu } from "./action-menu";
import { useFailedRunsMark } from "./failed-runs";
import { type FoldedGroups, useFoldedGroups } from "./folded-groups";
import { type HoverPane, useHoverPane } from "./hover-pane";
import { LukeIdentity } from "./luke-identity";
import { SidebarPlan } from "./plan-actions";
import { SidebarAgent } from "./sidebar-agent";
import { SIDEBAR_WIDTH, type SidebarCollapse } from "./sidebar-collapse";
import { SidebarFoot } from "./sidebar-foot";
import { type CountNoun, SidebarGroupHeader } from "./sidebar-group-header";
import { SidebarPinnedTab } from "./sidebar-pinned-tab";
import {
  SidebarSectionHead,
  TaskViewOptions,
  useTaskViewCommands,
  ViewChips,
} from "./sidebar-task-view";
import { useArchivedView, useTaskListView } from "./task-list-view";
import { EDGE_SIDE, type ResizableEdgeProps, useResizableEdge } from "./use-resizable-edge";
import { WorkspaceSwitcher } from "./workspace-switcher";

/**
 * What the sidebar leaves the work column beside it, in CSS pixels: the
 * sidebar is dragged no wider than the window less this.
 */
const WORK_RESERVE = 360;

/** What the header over the plans with no repository says. */
const NO_REPOSITORY = "No repository";

/** The widths of the plans' names while the list is first read, uneven as names are. */
const LIST_SKELETON = ["72%", "54%", "64%", "46%"] as const;

/**
 * The edge of the window's left column, the plans' sidebar or Settings' page
 * list, which share one width: resizing either resizes both. `onCollapse`
 * folds the column away past its least width; without it, as in Settings,
 * where there is no plans' sidebar to fold, the drag holds at the bound.
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
        <button
          type="button"
          className="icon-button"
          aria-label="Back"
          disabled={!history.canGoBack}
          onClick={history.onBack}
        >
          <ArrowLeftIcon />
        </button>
      </Tooltip>
      <Tooltip label="Forward" command={APP_COMMAND.FORWARD}>
        <button
          type="button"
          className="icon-button"
          aria-label="Forward"
          disabled={!history.canGoForward}
          onClick={history.onForward}
        >
          <ArrowRightIcon />
        </button>
      </Tooltip>
    </div>
  );
}

/** What every row of the plans is drawn with, whichever section it stands in. */
interface RowContext {
  readonly plans: PlansControl;
  /** Whether a plan is the one open, which a fold still leaves standing. */
  readonly current: (planId: string) => boolean;
  /** Whether a row is the one the sidebar marks: the pin the open plan was opened from, else the open plan's own row. */
  readonly marked: (planId: string, pin: PinnedTab | undefined) => boolean;
  readonly onOpen: (planId: string) => void;
  /** Whether a row is the one standing: the open plan's, or the agent's whose page stands. */
  readonly currentRow: (row: TaskRow) => boolean;
  /** Opens an agent with no plan on its own page. */
  readonly onOpenAgent: (agentId: string) => void;
  /** Whether a plan was saved since the developer last looked at it on this Mac. */
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
}

/**
 * One group's rows, each a plan's or an agent's with no plan, showing the
 * time the list's order chooses. A row says what its group does not: its
 * repository's name where `repository` names one, and a teammate's face
 * unless `face` is off, as under a group by creator.
 */
function PlanRows({
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
  return (
    <ul className="sidebar-plans">
      {rows.map((row) =>
        row.kind === TASK_ROW.TASK ? (
          <SidebarPlan
            key={row.plan.id}
            plans={context.plans}
            plan={row.plan}
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
            shown={context.plans.shown && context.inSight}
            onOpen={() => context.onOpenAgent(row.agent.id)}
            onPin={pinOf(context.plans, row.agent)}
          />
        ),
      )}
    </ul>
  );
}

/** Pin or Unpin for an agent's row, the account's own; none for an archived agent, which the sidebar draws among the archived whether or not it is pinned, as a plan's. */
function pinOf(plans: PlansControl, agent: TasklessAgent): ((pinned: boolean) => void) | undefined {
  return agent.archivedAt === undefined
    ? (pinned) => plans.onPinAgent(agent.id, pinned)
    : undefined;
}

/** One row under Pinned: a pinned plan, a tab pinned on a listed plan, or a pinned agent with no plan, and when it was pinned. */
type PinnedRow =
  | {
      readonly kind: typeof TASK_ROW.TASK;
      readonly plan: TaskSummary;
      readonly pin: PinnedTab | undefined;
      readonly at: number;
    }
  | { readonly kind: typeof TASK_ROW.AGENT; readonly agent: TasklessAgent; readonly at: number };

/**
 * The rows under Pinned, newest pinned first: the pinned plans, the pinned
 * agents with no plan among them, and the tabs pinned to the sidebar on
 * plans the list holds. A tab of an archived or deleted plan is drawn
 * nowhere, its plan being out of the list.
 */
function pinnedRows(
  pinned: readonly TaskSummary[],
  agents: readonly TasklessAgent[],
  plans: PlansControl,
): PinnedRow[] {
  const planRows = pinned.map(
    (plan): PinnedRow => ({ kind: TASK_ROW.TASK, plan, pin: undefined, at: plan.pinnedAt ?? 0 }),
  );
  const agentRows = agents.map(
    (agent): PinnedRow => ({ kind: TASK_ROW.AGENT, agent, at: agent.pinnedAt ?? 0 }),
  );
  const tabRows = plans.sidePanel.pins.flatMap((pin): PinnedRow[] => {
    const plan = plans.listed.plans.find((each) => each.id === pin.plan);
    return plan === undefined ? [] : [{ kind: TASK_ROW.TASK, plan, pin, at: pin.at }];
  });
  return [...planRows, ...agentRows, ...tabRows].sort((a, b) => b.at - a.at);
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
}: {
  rows: readonly PinnedRow[];
  context: RowContext;
  onOpenTab: (pin: PinnedTab) => void;
}): React.JSX.Element {
  return (
    <ul className="sidebar-plans">
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
              shown={context.plans.shown && context.inSight}
              onOpen={() => context.onOpenAgent(agent.id)}
              onPin={pinOf(context.plans, agent)}
            />
          );
        }
        const { plan, pin } = row;
        return pin === undefined ? (
          <SidebarPlan
            key={plan.id}
            plans={context.plans}
            plan={plan}
            current={context.marked(plan.id, undefined)}
            open={context.current(plan.id)}
            unread={context.unread(plan)}
            now={context.now}
            onOpen={() => context.onOpen(plan.id)}
          />
        ) : (
          <SidebarPinnedTab
            key={String(pin.at)}
            plans={context.plans}
            pin={pin}
            plan={plan}
            current={context.marked(plan.id, pin)}
            inSight={context.inSight}
            onOpen={() => onOpenTab(pin)}
            onOpenPlan={() => context.onOpen(plan.id)}
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
 * repository's fold.
 */
function PinnedSection({
  rows,
  folds,
  shown,
  context,
  onOpenTab,
}: {
  rows: readonly PinnedRow[];
  folds: FoldedGroups;
  /** Whether a row is the plan open, the agent whose page stands, or the pinned tab on show, which a fold leaves standing. */
  shown: (row: PinnedRow) => boolean;
  context: RowContext;
  onOpenTab: (pin: PinnedTab) => void;
}): React.JSX.Element {
  const folded = folds.pinnedFolded;
  const drawn = folded ? rows.filter(shown) : rows;
  return (
    <nav className="sidebar-group" aria-label="Pinned">
      <SidebarSectionHead
        name="Pinned"
        folded={folded}
        count={rows.length}
        noun={PIN_NOUN}
        onToggle={folds.togglePinned}
      />
      {drawn.length === 0 ? null : (
        <PinnedRows rows={drawn} context={context} onOpenTab={onOpenTab} />
      )}
    </nav>
  );
}

/**
 * A repository's actions, offered alike from its header's ⋯ and from a
 * right-click on the header: Pin holds the group above the rest on the
 * account, Archive plans puts every plan under the header away, and Open on
 * GitHub opens the repository's page, under GitHub's mark rather than the
 * owner's picture, since it is about GitHub. The plans with no repository
 * have no pin, since they always stand last, and no page to open. A group of
 * archived plans offers no Archive, since its plans are already away, so the
 * plans with no repository offer nothing there.
 */
function repositoryActionGroups(
  group: RepositoryGroup,
  plans: PlansControl,
  archived: boolean,
): MenuAction[][] {
  const { repository } = group;
  // Note that only the group's plans are archived from here, because an agent is archived from its own page.
  const planIds = group.rows.flatMap((row) => (row.kind === TASK_ROW.TASK ? [row.plan.id] : []));
  const archive: MenuAction[] =
    archived || planIds.length === 0
      ? []
      : [
          {
            label: "Archive tasks",
            icon: <ArchiveIcon />,
            onSelect: () => plans.onArchivePlans(planIds),
          },
        ];
  if (repository === null) return archive.length === 0 ? [] : [archive];
  const pin: MenuAction = plans.pinnedRepositories.includes(repository)
    ? {
        label: "Unpin",
        icon: <UnpinIcon />,
        onSelect: () => plans.onPinRepository(repository, false),
      }
    : { label: "Pin", icon: <PinIcon />, onSelect: () => plans.onPinRepository(repository, true) };
  const github: MenuAction = {
    label: "Open on GitHub",
    icon: <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />,
    onSelect: () => plans.repositories.openGitHub(repositoryPageUrl(repository)),
  };
  return [[pin, ...archive], [github]];
}

/** Pinned holds tabs as well as plans, so its count is read as pins. */
const PIN_NOUN: CountNoun = { one: "pin", many: "pins" };

/**
 * One repository's plans under a header in the headings' voice, which folds
 * and unfolds them, the fold kept across launches. The header is a row like
 * a plan's, with its hover, led by the owner's picture, which gives way to
 * the fold's chevron while the header is hovered or reached from the
 * keyboard, pointing down while the group is open and right while it is
 * folded, the way Codex and Cursor draw a project. Its actions stand at its end while it is hovered or holds
 * focus: a ⋯ that drops the repository's menu, which a right-click anywhere
 * on the header opens too, and a + that starts a new plan with the
 * repository already chosen. Both stand beside the fold rather than inside
 * it, so pressing either folds nothing. Folded, the header counts its plans
 * at its end while hovered or reached from the keyboard, and the open plan
 * still stands under it, so the plan being worked on never leaves the list.
 * The plans with no repository stand under "No repository", with nothing to
 * preset and no page to open.
 */
function RepositorySection({
  group,
  label,
  folds,
  onNewPlanIn,
  context,
}: {
  group: RepositoryGroup;
  /** What the header says for the repository: its name, or `owner/name` where another shares the name. */
  label: string;
  folds: FoldedGroups;
  onNewPlanIn: (repository: string) => void;
  context: RowContext;
}): React.JSX.Element {
  const { repository } = group;
  const folded = folds.folded(repository);
  const named = repository === null ? NO_REPOSITORY : label;
  const rows = folded ? group.rows.filter(context.currentRow) : group.rows;
  // The menu is drawn over the window rather than inside the sidebar, so it
  // closes with the sidebar folding away as well as with the tab hiding.
  const menu = useActionMenu(context.plans.shown && context.inSight);
  const ellipsis = useRef<HTMLButtonElement | null>(null);
  const actionGroups = repositoryActionGroups(group, context.plans, context.archived);
  return (
    <div className="sidebar-repository">
      <SidebarGroupHeader
        glyph={
          repository === null ? (
            <FolderIcon />
          ) : (
            <RepositoryPicture
              repository={repository}
              pictures={context.plans.repositories.pictures}
              fallback={<FolderIcon />}
            />
          )
        }
        name={named}
        folded={folded}
        count={group.rows.length}
        trailing={
          repository !== null && context.plans.pinnedRepositories.includes(repository) ? (
            <span className="sidebar-repository-pinned">
              <PinIcon />
              <span className="visually-hidden">(pinned)</span>
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
                <button
                  ref={ellipsis}
                  type="button"
                  className="sidebar-repository-action"
                  aria-label={`Actions for ${named}`}
                  {...menu.trigger()}
                >
                  <EllipsisIcon />
                </button>
              </Tooltip>
            )}
            {repository === null ? null : (
              <Tooltip label={`New task in ${label}`}>
                <button
                  type="button"
                  className="sidebar-repository-action sidebar-repository-new"
                  aria-label={`New task in ${label}`}
                  onClick={() => onNewPlanIn(repository)}
                >
                  <PlusIcon />
                </button>
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
      {rows.length === 0 ? null : <PlanRows rows={rows} context={context} />}
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
      {rows.length === 0 ? null : <PlanRows rows={rows} context={context} face={false} />}
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
  tasks: readonly TaskRow[],
  grouping: TaskSections["grouping"],
  order: TaskOrder,
  plans: PlansControl,
  creatorName: (row: TaskRow) => string,
): TaskSections {
  if (grouping === TASK_GROUPING.CREATOR) {
    return { grouping, groups: creatorGroups(tasks, order, plans.me, creatorName) };
  }
  if (grouping === TASK_GROUPING.NONE) return { grouping, rows: orderTaskRows(tasks, order) };
  const grouped = repositoryGroups(tasks, order);
  const pinnedAt = (group: RepositoryGroup) =>
    group.repository === null ? -1 : plans.pinnedRepositories.indexOf(group.repository);
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
  onNewPlanIn,
  context,
}: {
  sections: TaskSections;
  repositoryOf: (row: TaskRow) => string | undefined;
  folds: FoldedGroups;
  onNewPlanIn: (repository: string) => void;
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
              onNewPlanIn={onNewPlanIn}
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
        <PlanRows rows={sections.rows} context={context} repository={repositoryOf} />
      );
  }
}

/**
 * The plans while the list is first read: a plan row's room and its name's
 * type for each block, one line as a row's name is, so the rows land where
 * the blocks stood. Nothing stands for the repository headers, whose number
 * nobody knows yet.
 */
function ListSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label="Reading your tasks…" className="sidebar-skeleton">
      {LIST_SKELETON.map((width) => (
        <div key={width} className="sidebar-skeleton-row">
          <Skeleton width={width} />
        </div>
      ))}
    </SkeletonRegion>
  );
}

/**
 * How many items wait on the developer: those of the listed workspace's
 * plans, the sum of the Inbox's row counts, and every one from an agent
 * with no plan, which names no workspace to be counted in.
 */
function waitingItems(plans: PlansControl): number {
  return plans.listed.inbox.reduce(
    (sum, plan) => sum + plan.items.length,
    plans.inboxPlanless.length,
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
    <button
      type="button"
      className="sidebar-search sidebar-home"
      aria-current={current ? "page" : undefined}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.HOME)}
      disabled={disabled}
      onClick={onOpen}
    >
      <HouseIcon />
      Home
      <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.HOME].chord} className="row-shortcut" />
    </button>
  );
}

/**
 * The Inbox's row, last of the rows heading the list and drawn as they are:
 * the tray, its name, and how many items wait on the developer across every
 * plan at its end, the sum of the counts the Inbox's rows show, muted in
 * even figures as a group's count is, and nothing at none. Its chord takes the count's place while the row is hovered or
 * reached from the keyboard, as New plan's and Search's show theirs. A press
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
    <button
      type="button"
      className="sidebar-search sidebar-inbox"
      aria-current={current ? "page" : undefined}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.INBOX)}
      disabled={disabled}
      onClick={onOpen}
    >
      <InboxIcon />
      Inbox
      {waiting === 0 ? null : (
        <span className="sidebar-inbox-waiting">
          {waiting}
          <span className="visually-hidden">
            {" "}
            {waiting === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many}
          </span>
        </span>
      )}
      <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.INBOX].chord} className="row-shortcut" />
    </button>
  );
}

/** How many messages wait on the developer in Chat: what For you lists. */
function waitingMessages(plans: PlansControl): number {
  const read = plans.chatView.chat;
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
    <button
      type="button"
      className="sidebar-search sidebar-inbox"
      aria-current={current ? "page" : undefined}
      onClick={onOpen}
    >
      <MessagesSquareIcon />
      Chat
      {waiting === 0 ? null : (
        <span className="sidebar-inbox-waiting">
          {waiting}
          <span className="visually-hidden"> waiting on you</span>
        </span>
      )}
    </button>
  );
}

/** What the sidebar is drawn with while it floats, or could. */
interface FloatingSidebar extends HoverPane {
  /** Whether the sidebar is on screen: pinned, or floating over the work. */
  readonly inSight: boolean;
}

/** Where a sidebar opened from away takes the keyboard: the row it marks, else New plan. */
function sidebarFocus(sidebar: HTMLElement): HTMLElement | null {
  return (
    sidebar.querySelector<HTMLElement>('[aria-current="page"]') ??
    sidebar.querySelector<HTMLElement>(".sidebar-new-plan")
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
    <button
      type="button"
      className="sidebar-search sidebar-factory"
      aria-current={current ? "page" : undefined}
      disabled={disabled}
      onClick={onOpen}
    >
      <FactoryIcon />
      Factory
    </button>
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
    <button
      type="button"
      className="sidebar-search sidebar-automations"
      aria-current={current ? "page" : undefined}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.AUTOMATIONS)}
      disabled={disabled}
      onClick={onOpen}
    >
      <ZapIcon />
      Automations
      {failed ? (
        <span className="sidebar-automations-failed">
          {stateEndMark(GLYPH_STATE.FAILED, false)}
        </span>
      ) : null}
      <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.AUTOMATIONS].chord} className="row-shortcut" />
    </button>
  );
}

/** What the sidebar is drawn from. */
interface DesktopSidebarProps {
  sidebar: SidebarCollapse;
  history: NavigationHistory;
  plans: PlansControl;
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
 * New plan, heading the list. Where the listed workspace has Linear
 * connected, a press opens the picker of its issues beside the button
 * (`linear-issue-picker.tsx`), whose Blank plan opens the New plan dialog;
 * anywhere else the press opens the dialog at once, as the menu bar's and
 * the chord's New plan always do.
 */
function NewPlanButton({
  plans,
  chosen,
  onNewPlan,
  onShowPlans,
}: {
  plans: PlansControl;
  chosen: FloatingSidebar["chosen"];
  onNewPlan: () => void;
  onShowPlans: () => void;
}): React.JSX.Element {
  const { linear } = plans.newPlan;
  const [picking, setPicking] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const open = picking && linear !== undefined;
  const blankPlan = chosen(onNewPlan);
  // Note that we hand focus back to New plan, as a menu returns it to its
  // trigger, because closing takes the focused search field away with it.
  const close = () => {
    setPicking(false);
    trigger.current?.focus();
  };
  const press = () => {
    if (linear === undefined) {
      blankPlan();
      return;
    }
    onShowPlans();
    setPicking(!open);
  };
  return (
    <div className="sidebar-new-plan-wrap" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="sidebar-new-plan"
        aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.NEW_PLAN)}
        aria-haspopup={linear === undefined ? undefined : "dialog"}
        aria-expanded={linear === undefined ? undefined : open}
        disabled={!plans.signedIn}
        onClick={press}
      >
        <ComposeIcon />
        New task
        <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.NEW_PLAN].chord} className="row-shortcut" />
      </button>
      {linear === undefined ? null : (
        <LinearIssuePicker
          open={open}
          read={linear.issues}
          start={linear.start}
          onBlankPlan={() => {
            setPicking(false);
            blankPlan();
          }}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && wrap.current?.contains(left))) setPicking(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * The window's left column: at its head the workspace chosen, by its tile
 * and name and who shares it, with the menu that chooses another
 * (`workspace-switcher.tsx`), or Luke while no workspace is read; the way to
 * a new plan, Search, which opens the command palette, every plan of the
 * workspace chosen, and the account's
 * row, whose menu and gear lead to Settings and the rest. Home's row, the
 * Inbox's, and Factory's follow Search above the rule: Home's goes to the
 * home page, the Inbox's counts what waits on the developer and opens the
 * window's Inbox, and Factory's, while its experiment is on, opens the
 * window's Factory, and the Automations page's likewise opens it; Chat's,
 * where a chat is read, counts what waits on the developer in Chat and opens
 * it. The pinned plans, and the side panel tabs
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
 * The open plan's row is marked, or, where the plan was opened from a pin,
 * that pin's row, while the plan stays open.
 * A plan's actions are a right-click on it away, whether or not it is open.
 * The strip above Luke is the window's drag handle and the traffic lights'
 * room, with back and forward at its right. Its right edge resizes it, and a drag well past its least width
 * folds it away. Folded away, it is inert as well as out of sight, so no key
 * reaches a row nobody can see, until it floats open over the work
 * (`sidebar-collapse.ts`). A floating sidebar is put away by a choice in it,
 * by Escape, or once the pointer leaves a peek; a press in a peek opens it,
 * so a menu it raises outlasts the pointer. Opened from away, it takes the
 * keyboard at the row it marks, else at New plan, and Escape gives the
 * keyboard back where it was. Floating, it has no edge to drag, since only a
 * pinned sidebar is resized.
 */
function SidebarColumn({
  sidebar,
  history,
  plans,
  tab,
  onTabChange,
  account,
  updates,
  onSignOut,
  call,
  onPressWithin,
}: DesktopSidebarProps): React.JSX.Element {
  const onPlans = tab === PANEL_TAB.TASKS;
  const overlay = useFloatingSidebar(sidebar);
  // The window's Inbox, an agent's page, Factory, the Automations page, and Chat stand in the plan's place, so while one does no plan is the place shown.
  const inInbox = onPlans && plans.inboxView.open;
  const inFactory = onPlans && plans.factoryView.open;
  const inAutomations = onPlans && plans.automationsView.open;
  const inChat = onPlans && plans.chatView.open;
  // Opening an automation sees its failed run, which the Automations row is marked for until then.
  const { place: automationsPlace } = plans.automationsView;
  const automationFailed = useFailedRunsMark(
    plans.failedRuns,
    plans.workspace?.id,
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
    (onPlans && plans.agentView.agentId !== undefined);
  // Factory and the Automations page are experiments: each row stands only while the account has it on.
  const factoryOn = useExperiment(EXPERIMENT.FACTORY);
  const automationsOn = useExperiment(EXPERIMENT.AUTOMATIONS);
  // A press in the list is always about plans, so it brings the Plans tab
  // forward from Settings as well as choosing.
  const openPlan = (planId: string) => {
    if (!onPlans) onTabChange(PANEL_TAB.TASKS);
    plans.onSelect(planId);
  };
  const showPlans = () => {
    if (!onPlans) onTabChange(PANEL_TAB.TASKS);
  };
  const newPlan = () => {
    showPlans();
    plans.onNewPlan();
  };
  const openPinnedTab = (pin: PinnedTab) => {
    if (!onPlans) onTabChange(PANEL_TAB.TASKS);
    plans.onOpenPinnedTab(pin);
  };
  const openInbox = () => {
    if (!onPlans) onTabChange(PANEL_TAB.TASKS);
    plans.inboxView.onOpen();
  };
  const openFactory = () => {
    if (!onPlans) onTabChange(PANEL_TAB.TASKS);
    plans.factoryView.onOpen();
  };
  const openAutomations = () => {
    if (!onPlans) onTabChange(PANEL_TAB.TASKS);
    plans.automationsView.onOpen();
  };
  const openChat = () => {
    if (!onPlans) onTabChange(PANEL_TAB.TASKS);
    plans.chatView.onOpen();
  };
  const goHome = () => {
    if (!onPlans) onTabChange(PANEL_TAB.TASKS);
    plans.onGoHome();
  };
  // The home page is the place shown while no plan is open, the Inbox is not
  // standing in its place, and no launch is still reopening a plan.
  const atHome = onPlans && !standingIn && plans.page === TASKS_PAGE.HOME && !plans.restoring;
  const newPlanIn = (repository: string) => {
    if (!onPlans) onTabChange(PANEL_TAB.TASKS);
    plans.onNewPlanIn(repository);
  };
  const folds = useFoldedGroups(sidebar.staged);
  const taskView = useTaskListView(plans.workspace?.id, sidebar.staged);
  const reader = useMemberDirectory();
  // Only a workspace somebody shares has creators to group and filter by.
  const { memberCount } = plans.workspace ?? {};
  const shared = memberCount === undefined ? (reader.members?.length ?? 0) > 1 : memberCount > 1;
  const createdBy = shared ? taskView.view.createdBy : undefined;
  const archive = useArchivedView(plans.workspace?.id, sidebar.staged);
  useTaskViewCommands({
    offered: plans.signedIn && plans.workspace !== undefined,
    control: taskView,
    shared,
    readerId: plans.me,
    archive,
  });
  const unread = useUnreadPlans([...plans.plans, ...plans.archived], {
    listRead: plans.listRead,
    staged: sidebar.staged,
  });
  const now = useMinute();
  const edge = useSidebarEdge(sidebar, sidebar.onToggle);
  const current = (planId: string) => onPlans && !standingIn && planId === plans.activePlanId;
  // An agent with no plan stands on its own page, which is the place shown while it stands.
  const agentShown = onPlans ? plans.agentView.agentId : undefined;
  const currentRow = (row: TaskRow) =>
    row.kind === TASK_ROW.TASK ? current(row.plan.id) : row.agent.id === agentShown;
  const openAgent = (agentId: string) => {
    if (!onPlans) onTabChange(PANEL_TAB.TASKS);
    plans.agentView.onOpen(agentId);
  };
  // The list is the chosen workspace's; the unread marks above read every plan.
  const { listed: listedRows, listedAgents } = plans;
  const unlisted =
    listedRows.plans.length === 0 &&
    listedRows.archived.length === 0 &&
    listedAgents.standing.length === 0 &&
    listedAgents.archived.length === 0;
  const pinned = plans.listed.plans.filter((plan) => plan.pinnedAt !== undefined);
  const pinnedAgents = listedAgents.standing.filter((agent) => agent.pinnedAt !== undefined);
  const pinnedSection = pinnedRows(pinned, pinnedAgents, plans);
  // The pin the open plan was opened from is marked in its plan's place,
  // whichever of the plan's tabs is shown, while its row still stands.
  const { chosenPin } = plans;
  const pinMarked = pinnedSection.find(
    (row) =>
      row.kind === TASK_ROW.TASK &&
      row.pin !== undefined &&
      chosenPin !== undefined &&
      current(row.plan.id) &&
      row.pin.plan === chosenPin.plan &&
      row.pin.at === chosenPin.at,
  );
  const markedPin = pinMarked?.kind === TASK_ROW.TASK ? pinMarked.pin : undefined;
  const { chosen } = overlay;
  const context: RowContext = {
    plans,
    current,
    marked: (planId, pin) =>
      markedPin === undefined ? pin === undefined && current(planId) : pin === markedPin,
    onOpen: chosen(openPlan),
    currentRow,
    onOpenAgent: chosen(openAgent),
    unread,
    unseenAgent: (agentId) =>
      plans.unreadTabs.some((tab) => isAgentTab(tab) && tab.agent === agentId),
    now,
    order: taskView.view.order,
    faces: createdBy === undefined,
    archived: archive.shown,
    inSight: overlay.inSight,
  };
  // A pinned tab is on show where its plan is open and its column shows it:
  // an agent's or the Inbox in the plan's own column, any other in the side panel. The
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
            ? sameTab(plans.mainTabs.tab, pin.tab)
            : plans.sidePanel.open &&
              plans.sidePanel.tab !== undefined &&
              sameTab(plans.sidePanel.tab, pin.tab))))
    );
  };
  // Note that the pins are never filtered, because a pin is already the
  // reader's own choice, and stand aside while the archived tasks are shown.
  // The agents with no plan stand among the plans, the archived ones among the archived.
  const unpinnedPlans = archive.shown
    ? listedRows.archived
    : listedRows.plans.filter((plan) => plan.pinnedAt === undefined);
  const unpinnedAgents = archive.shown
    ? listedAgents.archived
    : listedAgents.standing.filter((agent) => agent.pinnedAt === undefined);
  const unpinned = [...unpinnedPlans.map(taskRow), ...unpinnedAgents.map(agentRow)];
  const tasks = taskRowsCreatedBy(unpinned, createdBy);
  const { grouping, order } = taskView.view;
  const sections = taskSections(
    tasks,
    grouping === TASK_GROUPING.CREATOR && !shared ? TASK_GROUPING.REPOSITORY : grouping,
    order,
    plans,
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
  const drawn = [
    ...(archive.shown ? [] : folds.pinnedFolded ? pinnedDrawn.filter(currentRow) : pinnedDrawn),
    ...drawnTasks(sections, folds, currentRow),
  ];
  // Moving up and down the list as it reads: down from the home page, where
  // no row is open, is the first row. The ends go no further.
  const at = drawn.findIndex((row) =>
    agentShown === undefined
      ? row.kind === TASK_ROW.TASK && row.plan.id === plans.activePlanId
      : row.kind === TASK_ROW.AGENT && row.agent.id === agentShown,
  );
  const step = (by: number) => {
    const row = drawn[at + by];
    if (row === undefined) return;
    if (row.kind === TASK_ROW.TASK) openPlan(row.plan.id);
    else openAgent(row.agent.id);
  };
  const listed = plans.signedIn && drawn.length > 0;
  useAppCommand(APP_COMMAND.PREVIOUS_PLAN, listed && at > 0 ? () => step(-1) : undefined);
  useAppCommand(APP_COMMAND.NEXT_PLAN, listed && at < drawn.length - 1 ? () => step(1) : undefined);

  return (
    <aside
      ref={overlay.ref}
      className="desktop-sidebar"
      inert={!overlay.inSight}
      onPointerDown={() => {
        onPressWithin();
        overlay.onPress();
      }}
      onPointerLeave={overlay.onPointerLeave}
      onKeyDown={overlay.onKeyDown}
    >
      <div className="desktop-drag-strip" />
      <HistoryButtons history={history} />
      {/* The workspace heads the sidebar once one is read, as everything under it is that
          workspace's; Luke's own head stands until then. */}
      {plans.signedIn && plans.workspace !== undefined ? (
        <WorkspaceSwitcher plans={plans} inSight={overlay.inSight} />
      ) : (
        <LukeIdentity />
      )}

      <NewPlanButton plans={plans} chosen={chosen} onNewPlan={newPlan} onShowPlans={showPlans} />
      {/* Search is a second door to the command palette, drawn as New plan
          is, since it heads the list the same way. */}
      <button
        type="button"
        className="sidebar-search"
        aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.COMMAND_PALETTE)}
        onClick={chosen(() => runAppCommand(APP_COMMAND.COMMAND_PALETTE))}
      >
        <SearchIcon />
        Search
        <Shortcut
          chord={APP_SHORTCUTS[APP_COMMAND.COMMAND_PALETTE].chord}
          className="row-shortcut"
        />
      </button>
      <SidebarHomeRow current={atHome} disabled={!plans.signedIn} onOpen={chosen(goHome)} />
      <SidebarInboxRow
        waiting={plans.signedIn ? waitingItems(plans) : 0}
        current={inInbox}
        disabled={!plans.signedIn}
        onOpen={chosen(openInbox)}
      />
      {/* Chat's row stands wherever there is a chat to read: a signed-in run, or a fixture's staged one. */}
      {plans.signedIn && plans.chatView.available ? (
        <SidebarChatRow
          waiting={waitingMessages(plans)}
          current={inChat}
          onOpen={chosen(openChat)}
        />
      ) : null}
      {factoryOn ? (
        <SidebarFactoryRow
          current={inFactory}
          disabled={!plans.signedIn}
          onOpen={chosen(openFactory)}
        />
      ) : null}
      {automationsOn ? (
        <SidebarAutomationsRow
          current={inAutomations}
          failed={automationFailed}
          disabled={!plans.signedIn}
          onOpen={chosen(openAutomations)}
        />
      ) : null}
      <hr className="sidebar-rule" />

      {/* One scroller for both sections, so the pinned plans scroll away
          with the rest rather than holding half the column. */}
      <div className="sidebar-section scroll-fade">
        {plans.signedIn && pinnedSection.length > 0 && !archive.shown ? (
          <PinnedSection
            rows={pinnedSection}
            folds={folds}
            shown={pinnedShown}
            context={context}
            onOpenTab={chosen(openPinnedTab)}
          />
        ) : null}
        <nav className="sidebar-group" aria-label={archive.shown ? "Archived tasks" : "Tasks"}>
          {plans.signedIn ? (
            <SidebarSectionHead name={archive.shown ? "Archived tasks" : "Tasks"}>
              <TaskViewOptions
                shown={plans.shown && overlay.inSight}
                control={taskView}
                shared={shared}
                archive={archive}
                filtered={createdBy !== undefined || archive.shown}
              />
            </SidebarSectionHead>
          ) : null}
          {plans.signedIn ? (
            <ViewChips
              createdBy={createdBy}
              plans={unpinnedPlans}
              onClearCreatedBy={() => taskView.onCreatedBy(undefined)}
              archive={archive}
            />
          ) : null}
          {archive.shown && unpinned.length === 0 && plans.listRead && !plans.listFailed ? (
            <p className="sidebar-note">No archived tasks.</p>
          ) : null}
          {createdBy !== undefined &&
          tasks.length === 0 &&
          !unlisted &&
          !(archive.shown && unpinned.length === 0) &&
          plans.listRead &&
          !plans.listFailed ? (
            <p className="sidebar-note">
              {createdBy === plans.me ? "None of your tasks here." : "None of their tasks here."}{" "}
              <button
                type="button"
                className="toolbar-button quiet-button"
                onClick={() => taskView.onCreatedBy(undefined)}
              >
                Show all
              </button>
            </p>
          ) : null}
          {plans.listFailed ? (
            <div className="sidebar-note">
              <ReadFailure line="Your tasks could not be read." onRetry={plans.onRetryList} />
            </div>
          ) : null}
          {/* The list is empty before its first read lands, so that it
              holds none says nothing until the service has answered. */}
          {plans.signedIn && unlisted && !plans.listRead && !plans.listFailed ? (
            <ListSkeleton />
          ) : null}
          {plans.signedIn && unlisted && plans.listRead && !plans.listFailed && !archive.shown ? (
            <p className="sidebar-note">No tasks yet.</p>
          ) : null}
          {/* Every task and agent archived, the list would stand empty with no word of where they went. */}
          {plans.signedIn &&
          !archive.shown &&
          plans.listRead &&
          !plans.listFailed &&
          plans.listed.plans.length === 0 &&
          listedAgents.standing.length === 0 &&
          (plans.listed.archived.length > 0 || listedAgents.archived.length > 0) ? (
            <p className="sidebar-note">
              Every task is archived.{" "}
              <button
                type="button"
                className="toolbar-button quiet-button"
                onClick={() => archive.onShown(true)}
              >
                Show archived
              </button>
            </p>
          ) : null}
          {plans.signedIn ? null : <p className="sidebar-note">Sign in to start a task.</p>}
          <TaskGroups
            sections={sections}
            repositoryOf={repositoryOf}
            folds={folds}
            onNewPlanIn={chosen(newPlanIn)}
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
  const { workspace } = props.plans;
  return (
    <LinkWorkspaceProvider value={workspace?.slug ?? workspace?.id}>
      <MemberDirectory workspace={workspace} readerId={props.plans.me}>
        <SidebarColumn {...props} />
      </MemberDirectory>
    </LinkWorkspaceProvider>
  );
}
