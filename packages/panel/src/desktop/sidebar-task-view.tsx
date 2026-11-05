import type { TaskSummary } from "@repo/features/task-wire";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  BUTTON_SIZE,
  GROUP_ACTION_STATE,
  GroupAction,
  IconButton,
  TextButton,
  Tooltip,
  useMenu,
} from "@repo/ui";
import { ACTOR_KIND, type Actor, actorName, creatorActor, memberActor } from "@repo/ui/actor-model";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import {
  ASSIGNED_TO,
  type AssignedTo,
  type HiddenStatus,
  TASK_GROUPING,
} from "@repo/ui/task-list-model";
import { FolderGitIcon, ListIcon, SlidersHorizontalIcon } from "lucide-react";
import { useAppCommand } from "../app-commands.js";
import { commandHead, PANEL_COMMAND } from "../command-items.js";
import { useMemberDirectory } from "../member-directory.js";
import { memberReadNotice, PEOPLE_FILTER, peopleFilterActions } from "../member-rows.js";
import { TASK_STATUS_WORDS } from "../tasks/task-standing.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "./action-menu.js";
import type { TaskListViewControl } from "./task-list-view.js";
import { FILTERED } from "./tasks-page-options.js";

/**
 * sidebar-task-view.tsx -- the Tasks head's View options: how the list groups its tasks, and whose it holds.
 *
 * The sidebar lists the work under way, browsing left to the Tasks page, so
 * its one button, the Inbox's own sliders at the Tasks head's end, drops the
 * window's menu with two choices: Group by, Repository or None, and, in a
 * shared workspace, Assigned to: Me, Anyone, or each member by face. The
 * head itself says whose tasks the list holds, "My tasks", "Everyone's
 * tasks", or one member's, and while it holds anything but the reader's own
 * the button wears a dot, so a list of someone else's never passes for the
 * reader's. The button waits
 * for the pointer or the keyboard, as a repository's head's actions do, but
 * stands at rest wearing its dot while it lists anything but the reader's
 * (`GroupAction`).
 *
 * Under the list a quiet line says how many tasks the list leaves out, in
 * the backlog and settled, and opens the Tasks page, where they are browsed.
 */

/** What View options is called, on its button and its menu alike. */
const VIEW_OPTIONS = "View options";

/** What the Tasks head says for Me and Anyone; a member's list is called by their name (`tasksHeadWords`). */
const TASKS_HEAD_WORDS = {
  [ASSIGNED_TO.ME]: "My tasks",
  [ASSIGNED_TO.ANYONE]: "Everyone's tasks",
} as const;

/** Who the list is filtered to, as the window draws them: a member as read, else as a listed task names them, else someone. */
function filteredActor(
  userId: string,
  reader: ReturnType<typeof useMemberDirectory>,
  tasks: readonly TaskSummary[],
): Actor {
  const member = reader.members?.find((each) => each.userId === userId);
  if (member !== undefined) return memberActor(member, reader.readerId);
  const named = tasks.find((task) => task.createdBy?.userId === userId);
  return creatorActor(named ?? { ownerId: userId }, reader, undefined);
}

/** Assigned to's choices: Me, Anyone, then each other member, the one chosen checked, and while the members are read a row saying so. */
function assignedToChoices(
  chosen: AssignedTo,
  onChoose: (assignedTo: AssignedTo) => void,
  reader: ReturnType<typeof useMemberDirectory>,
): MenuAction[] {
  const people = peopleFilterActions({
    members: reader.members,
    readerId: reader.readerId,
    chosen:
      chosen.kind === ASSIGNED_TO.ANYONE
        ? { kind: PEOPLE_FILTER.ANYONE }
        : chosen.kind === ASSIGNED_TO.ME
          ? { kind: PEOPLE_FILTER.ME }
          : { kind: PEOPLE_FILTER.PERSON, userId: chosen.userId },
    onChoose: (filter) =>
      onChoose(
        filter.kind === PEOPLE_FILTER.ANYONE
          ? { kind: ASSIGNED_TO.ANYONE }
          : filter.kind === PEOPLE_FILTER.ME
            ? { kind: ASSIGNED_TO.ME }
            : { kind: ASSIGNED_TO.MEMBER, userId: filter.userId },
      ),
    // Me is the list's default, so it is offered and checked even before the reader's id is read.
    meWithoutId: true,
    meFirst: true,
  });
  // Note that a member is keyed by their id and Me and Anyone are not, so only a member's name is masked.
  return [
    ...people.map((item) =>
      item.key === undefined
        ? item
        : { ...item, replayMasked: true, icon: <ReplayMask>{item.icon}</ReplayMask> },
    ),
    ...memberReadNotice(reader),
  ];
}

/** The menu's choices: how the list groups, and, where the workspace is shared, whose tasks it holds. */
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
  return [
    [
      {
        ...commandHead(PANEL_COMMAND.GROUP_BY),
        items: [
          grouping("Repository", <FolderGitIcon />, TASK_GROUPING.REPOSITORY),
          grouping("None", <ListIcon />, TASK_GROUPING.NONE),
        ],
      },
      ...(shared
        ? [
            {
              ...commandHead(PANEL_COMMAND.ASSIGNED_TO),
              items: assignedToChoices(view.assignedTo, control.onAssignedTo, reader),
            },
          ]
        : []),
    ],
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
  /** Whether the workspace is shared, which alone filters by person. */
  shared: boolean;
  /** Whether the list holds anything but the reader's own, which keeps the button standing and dotted. */
  filtered: boolean;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const reader = useMemberDirectory();
  return (
    <GroupAction state={filtered ? GROUP_ACTION_STATE.ACTIVE : GROUP_ACTION_STATE.IDLE}>
      <Tooltip label={VIEW_OPTIONS}>
        <IconButton
          icon={<SlidersHorizontalIcon />}
          label={VIEW_OPTIONS}
          size={BUTTON_SIZE.COMPACT}
          aria-description={filtered ? FILTERED : undefined}
          {...menu.trigger()}
        />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={VIEW_OPTIONS}
          menu={menu.drawn}
          replayUnmasked
          groups={viewEntries(control, shared, reader)}
          onClose={menu.close}
        />
      )}
    </GroupAction>
  );
}

/**
 * What the Tasks head says, and its list is called: whose tasks the list
 * holds. Note that a workspace nobody shares lists every task, which are
 * all the reader's, so it says "My tasks" rather than "Everyone's tasks".
 */
export function tasksHeadWords(
  assignedTo: AssignedTo,
  shared: boolean,
  reader: ReturnType<typeof useMemberDirectory>,
  tasks: readonly TaskSummary[],
): string {
  if (!shared) return TASKS_HEAD_WORDS[ASSIGNED_TO.ME];
  if (assignedTo.kind !== ASSIGNED_TO.MEMBER) return TASKS_HEAD_WORDS[assignedTo.kind];
  const actor = filteredActor(assignedTo.userId, reader, tasks);
  if (actor.kind === ACTOR_KIND.PERSON && actor.you) return TASKS_HEAD_WORDS[ASSIGNED_TO.ME];
  return `${actorName(actor)}'s tasks`;
}

/** What the list says where its filters leave nothing, as the Tasks page says it; a section says it where they leave none of its rows. */
export const NONE_MATCH = "No tasks match this view.";

/** What the hidden tasks' line says: how many, and in which statuses, as `4 more in Backlog, Done`. */
function hiddenStatusesLine(hidden: readonly HiddenStatus[]): string {
  const count = hidden.reduce((sum, each) => sum + each.count, 0);
  return `${count} more in ${hidden.map((each) => TASK_STATUS_WORDS[each.status]).join(", ")}`;
}

/** The quiet line at the list's foot saying what the list leaves out, which opens the Tasks page; nothing where it leaves nothing out. */
export function HiddenStatusesLine({
  hidden,
  onOpen,
}: {
  hidden: readonly HiddenStatus[];
  /** Opens the Tasks page, where every status's tasks are browsed. */
  onOpen: () => void;
}): React.JSX.Element | null {
  if (hidden.length === 0) return null;
  return (
    <p className="sidebar-hidden-statuses mx-row-inset my-tight-gap text-caption text-muted-foreground">
      <TextButton onClick={onOpen}>{hiddenStatusesLine(hidden)}</TextButton>
    </p>
  );
}

/** Each choice's command offered only where taking it changes the view; nothing where `offered` is false. */
function offer(offered: boolean, changes: boolean, run: () => void): (() => void) | undefined {
  return offered && changes ? run : undefined;
}

/**
 * The view's choices as ⌘K offers them, each only while it would change
 * the list: Group tasks by repository, or in one list; and in a shared
 * workspace Show my tasks and Show everyone's tasks. They act as the View
 * options menu's choices do.
 */
export function useTaskViewCommands({
  offered,
  control,
  shared,
}: {
  /** Whether the list stands to be changed: signed in, a workspace listed. */
  offered: boolean;
  control: TaskListViewControl;
  shared: boolean;
}): void {
  const { grouping, assignedTo } = control.view;
  const group = (to: typeof grouping) =>
    offer(offered, grouping !== to, () => control.onGrouping(to));
  const assign = (to: AssignedTo) =>
    offer(offered && shared, assignedTo.kind !== to.kind, () => control.onAssignedTo(to));
  useAppCommand(APP_COMMAND.GROUP_TASKS_BY_REPOSITORY, group(TASK_GROUPING.REPOSITORY));
  useAppCommand(APP_COMMAND.LIST_TASKS_UNGROUPED, group(TASK_GROUPING.NONE));
  useAppCommand(APP_COMMAND.SHOW_MY_TASKS, assign({ kind: ASSIGNED_TO.ME }));
  useAppCommand(APP_COMMAND.SHOW_EVERYONES_TASKS, assign({ kind: ASSIGNED_TO.ANYONE }));
}
