import { TASK_STATUS_ORDER, type TaskStatus, type TaskSummary } from "@luke/features/task-wire";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  CHIP_LOOK,
  Chip,
  ChipName,
  dropBelowStart,
  IconButton,
  LIST_MOTION_WAY,
  ListMotion,
  motionRows,
  TaskStatusMark,
  TextButton,
  Tooltip,
  useLeaving,
  useMenu,
} from "@luke/ui";
import { type Actor, actorName, creatorActor, memberActor } from "@luke/ui/actor-model";
import {
  drawnGrouping,
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
} from "lucide-react";
import { type RefObject, useMemo, useRef } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { commandHead, PANEL_COMMAND } from "../command-items.js";
import { useMemberDirectory } from "../member-directory.js";
import { memberReadNotice, PEOPLE_FILTER, peopleFilterActions } from "../member-rows.js";
import { TASK_STATUS_WORDS } from "../tasks/task-standing.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "./action-menu.js";
import type { TaskListViewControl } from "./task-list-view.js";
import { FILTER } from "./tasks-page-options.js";

/**
 * sidebar-task-view.tsx -- the heads of the sidebar's two sections, Pinned and Tasks, and the Tasks head's View options: how the list groups and orders its tasks.
 *
 * Each head names its section in the headings' voice, a level above the
 * groups under it, so Pinned reads as a section of its own rather than as a
 * group among the repositories. A press on a head that folds folds its
 * section, and folded it counts what it holds. View options is the Inbox's
 * own sliders at the Tasks head's end, always in sight, dropping the
 * window's menu: Group by and Order by, each a submenu with its choice
 * checked, Group by offering Assignee and Creator in a shared workspace
 * alone, and in a shared workspace Assigned to and Created by: Anyone, Me,
 * or each member by face. While the view lists one member's tasks, a chip under the head
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

/** What the status filter's menu is labelled; its button is called Filter, as the Tasks page's is. */
const STATUS_FILTER_MENU = "Filter by status";

/** The menu the status filter's button and the hidden tasks' line both open. */
type StatusFilterMenu = ReturnType<typeof useMenu>;

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

/** Assigned to's and Created by's choices, as every filter by person offers them: Anyone, Me, then each other member, the account id filtered to checked, and while the members are read a row saying so. */
function memberFilter(
  chosen: string | undefined,
  onChoose: (userId: string | undefined) => void,
  reader: ReturnType<typeof useMemberDirectory>,
): MenuAction[] {
  const people = peopleFilterActions({
    members: reader.members,
    readerId: reader.readerId,
    chosen:
      chosen === undefined
        ? { kind: PEOPLE_FILTER.ANYONE }
        : chosen === reader.readerId
          ? { kind: PEOPLE_FILTER.ME }
          : { kind: PEOPLE_FILTER.PERSON, userId: chosen },
    onChoose: (filter) =>
      onChoose(
        filter.kind === PEOPLE_FILTER.ANYONE
          ? undefined
          : filter.kind === PEOPLE_FILTER.ME
            ? reader.readerId
            : filter.userId,
      ),
  });
  return [...people, ...memberReadNotice(reader)];
}

/** The menu's choices: how the list groups, Assignee and Creator only where the workspace is shared, how it orders, and who the tasks it lists are assigned to and who created them, where shared. */
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
        ...commandHead(PANEL_COMMAND.GROUP_BY),
        items: [
          grouping("Repository", <FolderGitIcon />, TASK_GROUPING.REPOSITORY),
          ...(shared
            ? [
                grouping("Assignee", <UserCheckIcon />, TASK_GROUPING.ASSIGNEE),
                grouping("Creator", <UserIcon />, TASK_GROUPING.CREATOR),
              ]
            : []),
          grouping("None", <ListIcon />, TASK_GROUPING.NONE),
        ],
      },
      {
        ...commandHead(PANEL_COMMAND.ORDER_BY),
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
              ...commandHead(PANEL_COMMAND.ASSIGNED_TO),
              items: memberFilter(view.assignedTo, control.onAssignedTo, reader),
            },
            {
              ...commandHead(PANEL_COMMAND.CREATED_BY),
              items: memberFilter(view.createdBy, control.onCreatedBy, reader),
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
  /** Whether the workspace is shared, which alone groups and filters by person. */
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
    <ActionMenu
      label={STATUS_FILTER_MENU}
      menu={menu.drawn}
      groups={[entries]}
      onClose={menu.close}
    />
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
        <Tooltip label={FILTER}>
          <IconButton icon={<ListFilterIcon />} label={FILTER} {...menu.trigger()} />
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

/** What each chip under the Tasks head is followed by, as it arrives and leaves. */
const VIEW_CHIP = {
  ASSIGNED_TO: "assignedTo",
  CREATED_BY: "createdBy",
} as const;

type ViewChipKey = (typeof VIEW_CHIP)[keyof typeof VIEW_CHIP];

/** One place under the Tasks head: a filter's chip, as last drawn, so it leaves looking as it did. */
interface ViewChipEntry {
  readonly key: ViewChipKey;
  readonly actor: Actor;
  readonly words: string;
  /** What the × does, said to a screen reader. */
  readonly lift: string;
}

/** The chips the view's filters by person call for, Assigned to's first. */
function viewChipEntries(
  createdBy: string | undefined,
  assignedTo: string | undefined,
  tasks: readonly TaskSummary[],
  reader: ReturnType<typeof useMemberDirectory>,
): ViewChipEntry[] {
  const entries: ViewChipEntry[] = [];
  if (assignedTo !== undefined) {
    const actor = filteredActor(assignedTo, reader, tasks);
    entries.push({
      key: VIEW_CHIP.ASSIGNED_TO,
      actor,
      words: assignedTo === reader.readerId ? "Assigned to me" : `Assigned to ${actorName(actor)}`,
      lift: "Show tasks assigned to anyone",
    });
  }
  if (createdBy !== undefined) {
    const actor = filteredActor(createdBy, reader, tasks);
    entries.push({
      key: VIEW_CHIP.CREATED_BY,
      actor,
      words: createdBy === reader.readerId ? "Created by me" : `Created by ${actorName(actor)}`,
      lift: "Show tasks created by anyone",
    });
  }
  return entries;
}

/** What a press on a chip leaving does, out of reach as it is: nothing. */
function stays(): void {}

/**
 * The chips themselves. Note that this is its own component under the
 * line's `ListMotion`, because `useLeaving` finds the motion through the
 * context the motion provides.
 */
function ViewChipLine({
  line,
  createdBy,
  assignedTo,
  tasks,
  onClearCreatedBy,
  onClearAssignedTo,
}: {
  line: RefObject<HTMLDivElement | null>;
  createdBy: string | undefined;
  assignedTo: string | undefined;
  tasks: readonly TaskSummary[];
  onClearCreatedBy: () => void;
  onClearAssignedTo: () => void;
}): React.JSX.Element {
  const reader = useMemberDirectory();
  // Note that the entries are made once for what they are made from, because `useLeaving` reads a new list as a change.
  const listed = useMemo(
    () => viewChipEntries(createdBy, assignedTo, tasks, reader),
    [createdBy, assignedTo, tasks, reader],
  );
  const drawn = useLeaving(listed, (entry) => entry.key);
  // Note that the box around the row stands hidden while nothing is filtered, so the row's padding takes no room, and a chip arriving arrives into a row that stands.
  return (
    <div ref={line} hidden={drawn.length === 0}>
      <div className="sidebar-view-chips" {...motionRows()}>
        {drawn.map(({ key, value, leaving }) => (
          <Chip
            key={key}
            motionKey={key}
            look={CHIP_LOOK.FILTER}
            removeLabel={value.lift}
            onRemove={
              leaving
                ? stays
                : value.key === VIEW_CHIP.ASSIGNED_TO
                  ? onClearAssignedTo
                  : onClearCreatedBy
            }
          >
            <ActorMark actor={value.actor} size={ACTOR_SIZE.MARK} />
            <ChipName>{value.words}</ChipName>
          </Chip>
        ))}
      </div>
    </div>
  );
}

/**
 * The chips under the Tasks head, while the view leaves tasks out: one
 * member's face and "Assigned to me" or "Assigned to" their name, whose ×
 * lists anyone's again; then one member's face and "Created by me" or
 * "Created by" their name, whose × lists everyone's again. Each scales in
 * as it is filtered and out as it is lifted, as the Tasks page's filter
 * chips do, under a `ListMotion` of its own.
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
}): React.JSX.Element {
  const line = useRef<HTMLDivElement | null>(null);
  return (
    <ListMotion root={line} way={LIST_MOTION_WAY.SCALE}>
      <ViewChipLine
        line={line}
        createdBy={createdBy}
        assignedTo={assignedTo}
        tasks={tasks}
        onClearCreatedBy={onClearCreatedBy}
        onClearAssignedTo={onClearAssignedTo}
      />
    </ListMotion>
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
  // A grouping by person kept for a workspace nobody shares now is drawn by
  // repository, so that is the grouping the commands read as standing.
  const grouping = drawnGrouping(control.view.grouping, shared);
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
