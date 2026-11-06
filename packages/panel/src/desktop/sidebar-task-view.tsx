import type { TaskSummary } from "@repo/features/task-wire";
import { noMatchWords, TERM } from "@repo/features/words";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  BUTTON_SIZE,
  GROUP_ACTION_STATE,
  GroupAction,
  IconButton,
  MENU_ITEM_MARK,
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
import { FolderGitIcon, SlidersHorizontalIcon } from "lucide-react";
import { useAppCommand } from "../app-commands.js";
import { commandHead, PANEL_COMMAND } from "../command-items.js";
import { useMemberDirectory } from "../member-directory.js";
import { memberReadNote, PEOPLE_FILTER, peopleFilterActions } from "../member-rows.js";
import { TASK_STATUS_WORDS } from "../tasks/task-standing.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "./action-menu.js";
import { actionSearchPanel } from "./action-search-menu.js";
import type { TaskListViewControl } from "./task-list-view.js";
import { FILTERED } from "./tasks-page-options.js";

const VIEW_OPTIONS = "View options";

const ASSIGNED_TO_PLACEHOLDER = "Search members";

const GROUP_BY_REPOSITORY = "Group by repository";

const TASKS_HEAD_WORDS = {
  [ASSIGNED_TO.ME]: "My tasks",
  [ASSIGNED_TO.ANYONE]: "Everyone's tasks",
} as const;

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
    meWithoutId: true,
    meFirst: true,
  });
  return [
    ...people.map((item) =>
      item.key === undefined
        ? item
        : { ...item, replayMasked: true, icon: <ReplayMask>{item.icon}</ReplayMask> },
    ),
  ];
}

function viewEntries(
  control: TaskListViewControl,
  shared: boolean,
  reader: ReturnType<typeof useMemberDirectory>,
): MenuEntry[][] {
  const { view } = control;
  const byRepository = view.grouping === TASK_GROUPING.REPOSITORY;
  const grouping: MenuAction = {
    label: GROUP_BY_REPOSITORY,
    icon: <FolderGitIcon />,
    checked: byRepository,
    mark: MENU_ITEM_MARK.SWITCH,
    stays: true,
    onSelect: () =>
      control.onGrouping(byRepository ? TASK_GROUPING.NONE : TASK_GROUPING.REPOSITORY),
  };
  return [
    [
      grouping,
      ...(shared
        ? [
            actionSearchPanel(commandHead(PANEL_COMMAND.ASSIGNED_TO), {
              label: commandHead(PANEL_COMMAND.ASSIGNED_TO).label,
              placeholder: ASSIGNED_TO_PLACEHOLDER,
              noMatch: noMatchWords(TERM.MEMBER),
              actions: assignedToChoices(view.assignedTo, control.onAssignedTo, reader),
              note: memberReadNote(reader),
              replayUnmasked: true,
            }),
          ]
        : []),
    ],
  ];
}

export function TaskViewOptions({
  shown,
  control,
  shared,
  filtered,
}: {
  shown: boolean;
  control: TaskListViewControl;
  shared: boolean;
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

export const NONE_MATCH = "No tasks match this view.";

function hiddenStatusesLine(hidden: readonly HiddenStatus[]): string {
  const count = hidden.reduce((sum, each) => sum + each.count, 0);
  return `${count} more in ${hidden.map((each) => TASK_STATUS_WORDS[each.status]).join(", ")}`;
}

export function HiddenStatusesLine({
  hidden,
  onOpen,
}: {
  hidden: readonly HiddenStatus[];
  onOpen: () => void;
}): React.JSX.Element | null {
  if (hidden.length === 0) return null;
  return (
    <p className="sidebar-hidden-statuses mx-row-inset my-tight-gap text-caption text-muted-foreground">
      <TextButton onClick={onOpen}>{hiddenStatusesLine(hidden)}</TextButton>
    </p>
  );
}

function offer(offered: boolean, changes: boolean, run: () => void): (() => void) | undefined {
  return offered && changes ? run : undefined;
}

export function useTaskViewCommands({
  offered,
  control,
  shared,
}: {
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
