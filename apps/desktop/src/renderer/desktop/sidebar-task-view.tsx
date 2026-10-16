import type { TaskSummary } from "@luke/features/task-wire";
import { ArchiveIcon } from "@luke/ui";
import { type Actor, actorName, creatorActor, memberActor } from "@luke/ui/actor-model";
import { TASK_GROUPING, TASK_ORDER } from "@luke/ui/task-list-model";
import {
  ArrowDownAZIcon,
  CalendarPlusIcon,
  ClockIcon,
  FolderGitIcon,
  ListIcon,
  SlidersHorizontalIcon,
  UserIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { ACTOR_SIZE, ActorMark } from "../actor-ref";
import { useAppCommand } from "../app-commands";
import { useMemberDirectory } from "../member-directory";
import { Tooltip } from "../tooltip";
import { ActionMenu, type MenuAction, type MenuEntry, useActionMenu } from "./action-menu";
import type { CountNoun } from "./sidebar-group-header";
import type { TaskListViewControl } from "./task-list-view";

/**
 * sidebar-task-view.tsx -- the heads of the sidebar's two sections, Pinned and Tasks, and the Tasks head's View options: how the list groups and orders its tasks.
 *
 * Each head names its section in the headings' voice, a level above the
 * groups under it, so Pinned reads as a section of its own rather than as a
 * group among the repositories. A press on a head that folds folds its
 * section, and folded it counts what it holds. View options is the Inbox's
 * own sliders at the Tasks head's end, always in sight, dropping the
 * window's menu: Group by and Order by, each a submenu with its choice
 * checked, in a shared workspace Created by: Anyone, Me, or each member by
 * face, and last Archived tasks, which turns the section to the archived
 * tasks, out of the way of the list rather than a group at its foot. While
 * the view lists one member's tasks or the archived ones, a chip under the
 * head says so, its × lifts it, and the button wears a dot, so a filtered
 * list never passes for the whole of it.
 */

/** What View options is called, on its button and its menu alike. */
const VIEW_OPTIONS = "View options";

/** A section's head: its name, which folds the section where it may be folded, and what stands at its end. */
export function SidebarSectionHead({
  name,
  folded,
  count,
  noun,
  onToggle,
  children,
}: {
  name: string;
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
      {onToggle === undefined ? (
        <span className="sidebar-section-head-name">{name}</span>
      ) : (
        <button
          type="button"
          className="sidebar-section-head-name"
          aria-expanded={folded !== true}
          onClick={onToggle}
        >
          {name}
          {folded === true && count !== undefined ? (
            <span className="sidebar-section-head-count">
              {count}
              {noun === undefined ? null : (
                <span className="visually-hidden"> {count === 1 ? noun.one : noun.many}</span>
              )}
            </span>
          ) : null}
        </button>
      )}
      {children}
    </div>
  );
}

/** Who the list is filtered to, as the window draws them: a member as read, else as a listed task names them, else someone. */
function filteredActor(
  createdBy: string,
  reader: ReturnType<typeof useMemberDirectory>,
  plans: readonly TaskSummary[],
): Actor {
  const member = reader.members?.find((each) => each.userId === createdBy);
  if (member !== undefined) return memberActor(member, reader.readerId);
  const named = plans.find((plan) => plan.createdBy?.userId === createdBy);
  return creatorActor(named ?? { ownerId: createdBy }, reader, undefined);
}

/** Created by's choices: Anyone, then Me, then each other member as read, the choice checked. */
function createdByEntries(
  control: TaskListViewControl,
  reader: ReturnType<typeof useMemberDirectory>,
): MenuAction[] {
  const { createdBy } = control.view;
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
            onSelect: () => control.onCreatedBy(reader.readerId),
          },
        ];
  return [
    {
      label: "Anyone",
      icon: <UsersIcon />,
      checked: createdBy === undefined,
      onSelect: () => control.onCreatedBy(undefined),
    },
    ...me,
    ...others.map((member) => ({
      label: member.name,
      icon: <ActorMark actor={memberActor(member, reader.readerId)} size={ACTOR_SIZE.INLINE} />,
      checked: createdBy === member.userId,
      onSelect: () => control.onCreatedBy(member.userId),
    })),
  ];
}

/** Whether the Tasks section shows the archived tasks, and the press that turns it to them or back. */
export interface ArchivedView {
  readonly shown: boolean;
  readonly onShown: (shown: boolean) => void;
}

/** The menu's choices: how the list groups, Creator only where the workspace is shared, how it orders, whose tasks it lists, where shared, and the archived tasks. */
function viewEntries(
  control: TaskListViewControl,
  shared: boolean,
  reader: ReturnType<typeof useMemberDirectory>,
  archive: ArchivedView,
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
              items: createdByEntries(control, reader),
            },
          ],
        ]
      : []),
    [
      {
        label: "Archived tasks",
        icon: <ArchiveIcon />,
        checked: archive.shown,
        onSelect: () => archive.onShown(!archive.shown),
      },
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
  archive,
  filtered,
}: {
  /** Whether the sidebar is on screen, for the menu not to outlive it. */
  shown: boolean;
  control: TaskListViewControl;
  /** Whether the workspace is shared, which alone groups and filters by creator. */
  shared: boolean;
  archive: ArchivedView;
  /** Whether the view leaves any task out, which the button's dot says. */
  filtered: boolean;
}): React.JSX.Element {
  const menu = useActionMenu(shown);
  const reader = useMemberDirectory();
  return (
    <>
      <Tooltip label={VIEW_OPTIONS}>
        <button
          type="button"
          className="icon-button sidebar-view-options"
          aria-label={VIEW_OPTIONS}
          aria-description={filtered ? "Filtered" : undefined}
          data-filtered={filtered ? "true" : undefined}
          {...menu.trigger()}
        >
          <SlidersHorizontalIcon className="icon-button-glyph" />
        </button>
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={VIEW_OPTIONS}
          menu={menu.drawn}
          groups={viewEntries(control, shared, reader, archive)}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** One chip under the Tasks head: what it says, led by a glyph, and its × that lifts it. */
function ViewChip({
  glyph,
  words,
  lift,
  onLift,
}: {
  glyph: React.JSX.Element;
  words: string;
  /** What the × does, said in its hint and to a screen reader. */
  lift: string;
  onLift: () => void;
}): React.JSX.Element {
  return (
    <span className="sidebar-view-chip">
      {glyph}
      <span className="sidebar-view-chip-words">{words}</span>
      <Tooltip label={lift}>
        <button type="button" aria-label={lift} onClick={onLift}>
          <XIcon />
        </button>
      </Tooltip>
    </span>
  );
}

/**
 * The chips under the Tasks head, while the view leaves tasks out: one
 * member's face and "Created by me" or "Created by" their name, whose ×
 * lists everyone's again, and Archived, whose × goes back to the tasks.
 */
export function ViewChips({
  createdBy,
  tasks,
  onClearCreatedBy,
  archive,
}: {
  createdBy: string | undefined;
  /** The listed tasks, which name a creator the members no longer list. */
  tasks: readonly TaskSummary[];
  onClearCreatedBy: () => void;
  archive: ArchivedView;
}): React.JSX.Element | null {
  const reader = useMemberDirectory();
  if (createdBy === undefined && !archive.shown) return null;
  const actor = createdBy === undefined ? undefined : filteredActor(createdBy, reader, tasks);
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
      {archive.shown ? (
        <ViewChip
          glyph={<ArchiveIcon />}
          words="Archived"
          lift="Back to the tasks"
          onLift={() => archive.onShown(false)}
        />
      ) : null}
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
 * in one list; Order tasks by last updated, created, or name; Show my tasks
 * and Show everyone's tasks in a shared workspace; and Show or Hide archived
 * tasks. They act as the View options menu's choices do.
 */
export function useTaskViewCommands({
  offered,
  control,
  shared,
  readerId,
  archive,
}: {
  /** Whether the list stands to be changed: signed in, a workspace listed. */
  offered: boolean;
  control: TaskListViewControl;
  shared: boolean;
  readerId: string | undefined;
  archive: ArchivedView;
}): void {
  const { order, createdBy } = control.view;
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
    offer(offered && shared && readerId !== undefined, createdBy !== readerId, () =>
      control.onCreatedBy(readerId),
    ),
  );
  useAppCommand(
    APP_COMMAND.SHOW_EVERYONES_TASKS,
    offer(offered && shared, createdBy !== undefined, () => control.onCreatedBy(undefined)),
  );
  useAppCommand(
    APP_COMMAND.SHOW_ARCHIVED_TASKS,
    offer(offered, !archive.shown, () => archive.onShown(true)),
  );
  useAppCommand(
    APP_COMMAND.HIDE_ARCHIVED_TASKS,
    offer(offered, archive.shown, () => archive.onShown(false)),
  );
}
