import { TASK_STATUS_ORDER, type TaskStatus, type TaskSummary } from "@luke/features/task-wire";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  CHIP_LOOK,
  Chip,
  ChipName,
  dropBelowStart,
  IconButton,
  NAV_ITEM_VARIANT,
  NavItem,
  TaskStatusMark,
  TextButton,
  Tooltip,
  useMenu,
} from "@luke/ui";
import { type Actor, actorName, creatorActor, memberActor } from "@luke/ui/actor-model";
import {
  type HiddenStatus,
  TASK_GROUPING,
  TASK_ORDER,
  toggledStatus,
} from "@luke/ui/task-list-model";
import {
  ArrowDownAZIcon,
  CalendarPlusIcon,
  ClockIcon,
  FolderGitIcon,
  ListFilterIcon,
  ListIcon,
  SlidersHorizontalIcon,
  UserCheckIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { useMemberDirectory } from "../member-directory.js";
import { TASK_STATUS_WORDS } from "../tasks/task-standing.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "./action-menu.js";
import type { CountNoun } from "./sidebar-group-header.js";
import type { TaskListViewControl } from "./task-list-view.js";

/**
 * sidebar-task-view.tsx -- the heads of the sidebar's two sections, Pinned and Tasks, and the Tasks head's View options: how the list groups and orders its tasks.
 *
 * Each head names its section in the headings' voice, a level above the
 * groups under it, so Pinned reads as a section of its own rather than as a
 * group among the repositories. A press on a head that folds folds its
 * section, and folded it counts what it holds. View options is the Inbox's
 * own sliders at the Tasks head's end, always in sight, dropping the
 * window's menu: Group by and Order by, each a submenu with its choice
 * checked, and in a shared workspace Created by: Anyone, Me, or each member
 * by face. While the view lists one member's tasks, a chip under the head
 * says so, its × lifts it, and the button wears a dot, so a filtered list
 * never passes for the whole of it.
 *
 * Beside it, revealed while the head is hovered or reached, stands the
 * status filter: which statuses' tasks the list holds, each checked, to do
 * and in progress until the reader chooses. Under the list a quiet line
 * says how many tasks the filter leaves out and in which statuses, and
 * opens the same menu under itself.
 */

/** What View options is called, on its button and its menu alike. */
const VIEW_OPTIONS = "View options";

/** What the status filter is called, on its button and its menu alike. */
const STATUS_FILTER = "Show statuses";

/** The menu the status filter's button and the hidden tasks' line both open. */
type StatusFilterMenu = ReturnType<typeof useMenu>;

/**
 * A section's head: its name, which folds the section where it may be
 * folded, and what stands at its end. A field the head opened, such as a
 * search, stands in the name's place while it is given (`field`), the end's
 * buttons kept as they stood, so a press on one is not lost to the head
 * drawn anew as the field gives way.
 */
export function SidebarSectionHead({
  name,
  field,
  folded,
  count,
  noun,
  onToggle,
  children,
}: {
  name: string;
  /** What stands in the name's place while the head holds it, such as a search it opened. */
  field?: ReactNode;
  /** Whether the section is folded, where its head folds it. */
  folded?: boolean;
  /** How many rows a folded section holds, shown after its name while folded. */
  count?: number;
  /** What the count is read as, one and many. */
  noun?: CountNoun;
  onToggle?: () => void;
  /** The head's buttons at its end. */
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="sidebar-section-head">
      {field !== undefined && field !== null ? (
        field
      ) : onToggle === undefined ? (
        <span className="sidebar-section-head-name">{name}</span>
      ) : (
        <NavItem
          variant={NAV_ITEM_VARIANT.HEAD}
          expanded={folded !== true}
          count={
            folded === true && count !== undefined
              ? {
                  value: count,
                  noun: noun === undefined ? undefined : count === 1 ? noun.one : noun.many,
                }
              : undefined
          }
          onClick={onToggle}
        >
          {name}
        </NavItem>
      )}
      {children}
    </div>
  );
}

/** Who the list is filtered to, as the window draws them: a member as read, else as a listed task names them, else someone. */
function filteredActor(
  createdBy: string,
  reader: ReturnType<typeof useMemberDirectory>,
  tasks: readonly TaskSummary[],
): Actor {
  const member = reader.members?.find((each) => each.userId === createdBy);
  if (member !== undefined) return memberActor(member, reader.readerId);
  const named = tasks.find((task) => task.createdBy?.userId === createdBy);
  return creatorActor(named ?? { ownerId: createdBy }, reader, undefined);
}

/** Created by's and Assigned to's choices: Anyone, then Me, then each other member as read, the choice checked. */
function memberEntries(
  createdBy: string | undefined,
  onCreatedBy: (createdBy: string | undefined) => void,
  reader: ReturnType<typeof useMemberDirectory>,
): MenuAction[] {
  const others = (reader.members ?? []).filter((member) => member.userId !== reader.readerId);
  const me =
    reader.readerId === undefined
      ? []
      : [
          {
            label: "Me",
            icon: (
              <ActorMark
                actor={filteredActor(reader.readerId, reader, [])}
                size={ACTOR_SIZE.INLINE}
              />
            ),
            checked: createdBy === reader.readerId,
            onSelect: () => onCreatedBy(reader.readerId),
          },
        ];
  return [
    {
      label: "Anyone",
      icon: <UsersIcon />,
      checked: createdBy === undefined,
      onSelect: () => onCreatedBy(undefined),
    },
    ...me,
    ...others.map((member) => ({
      label: member.name,
      icon: <ActorMark actor={memberActor(member, reader.readerId)} size={ACTOR_SIZE.INLINE} />,
      checked: createdBy === member.userId,
      onSelect: () => onCreatedBy(member.userId),
    })),
  ];
}

/** The menu's choices: how the list groups, Creator only where the workspace is shared, how it orders, and whose tasks it lists and who they are assigned to, where shared. */
function viewEntries(
  control: TaskListViewControl,
  shared: boolean,
  reader: ReturnType<typeof useMemberDirectory>,
): MenuEntry[][] {
  const { view } = control;
  const grouping = (
    label: string,
    icon: React.JSX.Element,
    value: TaskListViewControl["view"]["grouping"],
  ): MenuAction => ({
    label,
    icon,
    checked: view.grouping === value,
    onSelect: () => control.onGrouping(value),
  });
  const order = (
    label: string,
    icon: React.JSX.Element,
    value: TaskListViewControl["view"]["order"],
  ): MenuAction => ({
    label,
    icon,
    checked: view.order === value,
    onSelect: () => control.onOrder(value),
  });
  return [
    [
      {
        label: "Group by",
        icon: <ListIcon />,
        items: [
          grouping("Repository", <FolderGitIcon />, TASK_GROUPING.REPOSITORY),
          ...(shared ? [grouping("Creator", <UserIcon />, TASK_GROUPING.CREATOR)] : []),
          grouping("None", <ListIcon />, TASK_GROUPING.NONE),
        ],
      },
      {
        label: "Order by",
        icon: <ClockIcon />,
        items: [
          order("Last updated", <ClockIcon />, TASK_ORDER.UPDATED),
          order("Created", <CalendarPlusIcon />, TASK_ORDER.CREATED),
          order("Name", <ArrowDownAZIcon />, TASK_ORDER.NAME),
        ],
      },
    ],
    ...(shared
      ? [
          [
            {
              label: "Created by",
              icon: <UsersIcon />,
              items: memberEntries(view.createdBy, control.onCreatedBy, reader),
            },
            {
              label: "Assigned to",
              icon: <UserCheckIcon />,
              items: memberEntries(view.assignedTo, control.onAssignedTo, reader),
            },
          ],
        ]
      : []),
  ];
}

/**
 * The Tasks head's button and the menu it drops. A choice in it keeps a
 * floating sidebar open, since whoever chose is still reading the list.
 */
export function TaskViewOptions({
  shown,
  control,
  shared,
  filtered,
}: {
  /** Whether the sidebar is on screen, for the menu not to outlive it. */
  shown: boolean;
  control: TaskListViewControl;
  /** Whether the workspace is shared, which alone groups and filters by creator. */
  shared: boolean;
  /** Whether the view leaves any task out, which the button's dot says. */
  filtered: boolean;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const reader = useMemberDirectory();
  return (
    <>
      <span className="sidebar-view-options" data-filtered={filtered ? "true" : undefined}>
        <Tooltip label={VIEW_OPTIONS}>
          <IconButton
            icon={<SlidersHorizontalIcon />}
            label={VIEW_OPTIONS}
            aria-description={filtered ? "Filtered" : undefined}
            {...menu.trigger()}
          />
        </Tooltip>
      </span>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={VIEW_OPTIONS}
          menu={menu.drawn}
          groups={viewEntries(control, shared, reader)}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The status filter's menu: a status a line, its mark leading and a check where its tasks are listed. */
function StatusFilterMenuDrawn({
  menu,
  statuses,
  onStatuses,
}: {
  menu: StatusFilterMenu;
  statuses: readonly TaskStatus[];
  onStatuses: (statuses: readonly TaskStatus[]) => void;
}): React.JSX.Element | null {
  if (menu.drawn === undefined) return null;
  const entries: MenuAction[] = TASK_STATUS_ORDER.map((status) => ({
    label: TASK_STATUS_WORDS[status],
    icon: <TaskStatusMark status={status} />,
    checked: statuses.includes(status),
    onSelect: () => onStatuses(toggledStatus(statuses, status)),
  }));
  return (
    <ActionMenu label={STATUS_FILTER} menu={menu.drawn} groups={[entries]} onClose={menu.close} />
  );
}

/**
 * The Tasks head's status filter: its button, which always stands, and the
 * menu it drops.
 */
export function TaskStatusFilter({
  menu,
  statuses,
  onStatuses,
}: {
  /** The menu it opens, which the hidden tasks' line opens too. */
  menu: StatusFilterMenu;
  statuses: readonly TaskStatus[];
  onStatuses: (statuses: readonly TaskStatus[]) => void;
}): React.JSX.Element {
  return (
    <>
      <span className="sidebar-status-filter">
        <Tooltip label={STATUS_FILTER}>
          <IconButton icon={<ListFilterIcon />} label={STATUS_FILTER} {...menu.trigger()} />
        </Tooltip>
      </span>
      <StatusFilterMenuDrawn menu={menu} statuses={statuses} onStatuses={onStatuses} />
    </>
  );
}

/** What the hidden tasks' line says: how many, and in which statuses, as `4 more in Backlog, Done`. */
function hiddenStatusesLine(hidden: readonly HiddenStatus[]): string {
  const count = hidden.reduce((sum, each) => sum + each.count, 0);
  return `${count} more in ${hidden.map((each) => TASK_STATUS_WORDS[each.status]).join(", ")}`;
}

/** The quiet line at the list's foot saying what the status filter leaves out, which opens the filter under itself; nothing where it leaves nothing out. */
export function HiddenStatusesLine({
  menu,
  hidden,
}: {
  menu: StatusFilterMenu;
  hidden: readonly HiddenStatus[];
}): React.JSX.Element | null {
  if (hidden.length === 0) return null;
  const opener = menu.trigger(dropBelowStart);
  return (
    <p className="sidebar-hidden-statuses">
      <TextButton aria-expanded={opener["aria-expanded"]} onClick={opener.onClick}>
        {hiddenStatusesLine(hidden)}
      </TextButton>
    </p>
  );
}

/** One chip under the Tasks head: `@luke/ui`'s removable filter, what it says led by a glyph, and its × that lifts it. */
function ViewChip({
  glyph,
  words,
  lift,
  onLift,
}: {
  glyph: React.JSX.Element;
  words: string;
  /** What the × does, said to a screen reader. */
  lift: string;
  onLift: () => void;
}): React.JSX.Element {
  return (
    <Chip look={CHIP_LOOK.FILTER} removeLabel={lift} onRemove={onLift}>
      {glyph}
      <ChipName>{words}</ChipName>
    </Chip>
  );
}

/**
 * The chips under the Tasks head, while the view leaves tasks out: one
 * member's face and "Created by me" or "Created by" their name, whose ×
 * lists everyone's again; and one member's face and "Assigned to me" or
 * "Assigned to" their name, whose × lists anyone's again.
 */
export function ViewChips({
  createdBy,
  assignedTo,
  tasks,
  onClearCreatedBy,
  onClearAssignedTo,
}: {
  createdBy: string | undefined;
  assignedTo: string | undefined;
  /** The listed tasks, which name a creator the members no longer list. */
  tasks: readonly TaskSummary[];
  onClearCreatedBy: () => void;
  onClearAssignedTo: () => void;
}): React.JSX.Element | null {
  const reader = useMemberDirectory();
  if (createdBy === undefined && assignedTo === undefined) return null;
  const actor = createdBy === undefined ? undefined : filteredActor(createdBy, reader, tasks);
  const assignee = assignedTo === undefined ? undefined : filteredActor(assignedTo, reader, tasks);
  return (
    <div className="sidebar-view-chips">
      {actor === undefined ? null : (
        <ViewChip
          glyph={<ActorMark actor={actor} size={ACTOR_SIZE.MARK} />}
          words={createdBy === reader.readerId ? "Created by me" : `Created by ${actorName(actor)}`}
          lift="Show everyone's tasks"
          onLift={onClearCreatedBy}
        />
      )}
      {assignee === undefined ? null : (
        <ViewChip
          glyph={<ActorMark actor={assignee} size={ACTOR_SIZE.MARK} />}
          words={
            assignedTo === reader.readerId ? "Assigned to me" : `Assigned to ${actorName(assignee)}`
          }
          lift="Show tasks assigned to anyone"
          onLift={onClearAssignedTo}
        />
      )}
    </div>
  );
}

/** Each choice's command offered only where taking it changes the view; nothing where `offered` is false. */
function offer(offered: boolean, changes: boolean, run: () => void): (() => void) | undefined {
  return offered && changes ? run : undefined;
}

/**
 * The view's choices as ⌘K offers them, each only while it would change
 * the list: Group tasks by repository, by creator in a shared workspace, or
 * in one list; Order tasks by last updated, created, or name; Show my tasks,
 * the tasks assigned to the reader whoever created them, and Show everyone's
 * tasks, which lets go of both filters by person, in a shared workspace. They
 * act as the View options menu's choices do.
 */
export function useTaskViewCommands({
  offered,
  control,
  shared,
  readerId,
}: {
  /** Whether the list stands to be changed: signed in, a workspace listed. */
  offered: boolean;
  control: TaskListViewControl;
  shared: boolean;
  readerId: string | undefined;
}): void {
  const { order, createdBy, assignedTo } = control.view;
  // A grouping by creator kept for a workspace nobody shares now is drawn by
  // repository, so that is the grouping the commands read as standing.
  const grouping =
    !shared && control.view.grouping === TASK_GROUPING.CREATOR
      ? TASK_GROUPING.REPOSITORY
      : control.view.grouping;
  const group = (to: typeof grouping, allowed = true) =>
    offer(offered && allowed, grouping !== to, () => control.onGrouping(to));
  const orderBy = (to: typeof order) => offer(offered, order !== to, () => control.onOrder(to));
  useAppCommand(APP_COMMAND.GROUP_TASKS_BY_REPOSITORY, group(TASK_GROUPING.REPOSITORY));
  useAppCommand(APP_COMMAND.GROUP_TASKS_BY_CREATOR, group(TASK_GROUPING.CREATOR, shared));
  useAppCommand(APP_COMMAND.LIST_TASKS_UNGROUPED, group(TASK_GROUPING.NONE));
  useAppCommand(APP_COMMAND.ORDER_TASKS_BY_UPDATED, orderBy(TASK_ORDER.UPDATED));
  useAppCommand(APP_COMMAND.ORDER_TASKS_BY_CREATED, orderBy(TASK_ORDER.CREATED));
  useAppCommand(APP_COMMAND.ORDER_TASKS_BY_NAME, orderBy(TASK_ORDER.NAME));
  useAppCommand(
    APP_COMMAND.SHOW_MY_TASKS,
    offer(
      offered && shared && readerId !== undefined,
      assignedTo !== readerId || createdBy !== undefined,
      () => {
        if (readerId !== undefined) control.onAssignedToAlone(readerId);
      },
    ),
  );
  useAppCommand(
    APP_COMMAND.SHOW_EVERYONES_TASKS,
    offer(
      offered && shared,
      createdBy !== undefined || assignedTo !== undefined,
      control.onEveryone,
    ),
  );
}
