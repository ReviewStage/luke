import type { TaskSummary } from "@luke/features/task-wire";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  CHIP_LOOK,
  Chip,
  ChipName,
  GROUP_ACTION_STATE,
  GroupAction,
  IconButton,
  LIST_MOTION_WAY,
  ListMotion,
  motionRows,
  TextButton,
  Tooltip,
  useLeaving,
  useMenu,
} from "@luke/ui";
import { type Actor, actorName, creatorActor, memberActor } from "@luke/ui/actor-model";
import {
  ASSIGNED_TO,
  type AssignedTo,
  type HiddenStatus,
  TASK_GROUPING,
} from "@luke/ui/task-list-model";
import { FolderGitIcon, ListIcon, SlidersHorizontalIcon, UsersIcon } from "lucide-react";
import { type RefObject, useMemo, useRef } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
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
 * shared workspace, Assigned to: Me, Anyone, or each member by face. While
 * the list holds anything but the reader's own, a chip under the head says
 * whose, its × lists the reader's again, and the button wears a dot, so a
 * list of someone else's never passes for the reader's. The button waits
 * for the pointer or the keyboard, as a repository's head's actions do, but
 * stands at rest wearing its dot while it lists anything but the reader's
 * (`GroupAction`).
 *
 * Under the list a quiet line says how many tasks the list leaves out, in
 * the backlog and settled, and opens the Tasks page, where they are browsed.
 */

/** What View options is called, on its button and its menu alike. */
const VIEW_OPTIONS = "View options";

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
    meFirst: true,
  });
  return [...people, ...memberReadNotice(reader)];
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
          aria-description={filtered ? FILTERED : undefined}
          {...menu.trigger()}
        />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={VIEW_OPTIONS}
          menu={menu.drawn}
          groups={viewEntries(control, shared, reader)}
          onClose={menu.close}
        />
      )}
    </GroupAction>
  );
}

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

/** What the chip under the Tasks head is followed by, as it arrives and leaves. */
const VIEW_CHIP_KEY = "assignedTo";

/** The chip under the Tasks head, as last drawn, so it leaves looking as it did. */
interface ViewChipEntry {
  /** A teammate's face, or none for Anyone, which draws the people glyph. */
  readonly actor: Actor | undefined;
  readonly words: string;
}

/** The chip Assigned to calls for: none for Me, the list's own. */
function viewChipEntries(
  assignedTo: AssignedTo,
  tasks: readonly TaskSummary[],
  reader: ReturnType<typeof useMemberDirectory>,
): ViewChipEntry[] {
  switch (assignedTo.kind) {
    case ASSIGNED_TO.ME:
      return [];
    case ASSIGNED_TO.ANYONE:
      return [{ actor: undefined, words: "Assigned to anyone" }];
    case ASSIGNED_TO.MEMBER: {
      const actor = filteredActor(assignedTo.userId, reader, tasks);
      return [{ actor, words: `Assigned to ${actorName(actor)}` }];
    }
  }
}

/** What a press on a chip leaving does, out of reach as it is: nothing. */
function stays(): void {}

/**
 * The chip itself. Note that this is its own component under the line's
 * `ListMotion`, because `useLeaving` finds the motion through the context
 * the motion provides.
 */
function ViewChipLine({
  line,
  assignedTo,
  tasks,
  onClear,
}: {
  line: RefObject<HTMLDivElement | null>;
  assignedTo: AssignedTo;
  tasks: readonly TaskSummary[];
  onClear: () => void;
}): React.JSX.Element {
  const reader = useMemberDirectory();
  // Note that the entries are made once for what they are made from, because `useLeaving` reads a new list as a change.
  const listed = useMemo(
    () => viewChipEntries(assignedTo, tasks, reader),
    [assignedTo, tasks, reader],
  );
  const drawn = useLeaving(listed, () => VIEW_CHIP_KEY);
  // Note that the box around the row stands hidden while nothing is filtered, so the row's padding takes no room, and a chip arriving arrives into a row that stands.
  return (
    <div ref={line} hidden={drawn.length === 0}>
      <div
        className="sidebar-view-chips flex flex-wrap gap-tight-gap px-item-gap pb-item-gap"
        {...motionRows()}
      >
        {drawn.map(({ key, value, leaving }) => (
          <Chip
            key={key}
            motionKey={key}
            look={CHIP_LOOK.FILTER}
            removeLabel="Show my tasks"
            onRemove={leaving ? stays : onClear}
          >
            {value.actor === undefined ? (
              <UsersIcon />
            ) : (
              <ActorMark actor={value.actor} size={ACTOR_SIZE.MARK} />
            )}
            <ChipName>{value.words}</ChipName>
          </Chip>
        ))}
      </div>
    </div>
  );
}

/**
 * The chip under the Tasks head while the list holds anything but the
 * reader's own: "Assigned to anyone", or one member's face and "Assigned
 * to" their name, whose × lists the reader's own again. It scales in as it
 * is chosen and out as it is lifted, as the Tasks page's filter chips do,
 * under a `ListMotion` of its own.
 */
export function ViewChips({
  assignedTo,
  tasks,
  onClear,
}: {
  assignedTo: AssignedTo;
  /** The listed tasks, which name a member the members no longer list. */
  tasks: readonly TaskSummary[];
  onClear: () => void;
}): React.JSX.Element {
  const line = useRef<HTMLDivElement | null>(null);
  return (
    <ListMotion root={line} way={LIST_MOTION_WAY.SCALE}>
      <ViewChipLine line={line} assignedTo={assignedTo} tasks={tasks} onClear={onClear} />
    </ListMotion>
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
