import type { PlanSummary } from "@luke/features/plan-wire";
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
import { ACTOR_SIZE, ActorMark } from "../actor-ref";
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
 * checked, and in a shared workspace Created by: Anyone, Me, or each
 * member by face. While the view lists one member's tasks, a chip under
 * the head says whose, its × lists everyone's again, and the button wears
 * a dot, so a filtered list never passes for the whole of it.
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
  plans: readonly PlanSummary[],
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

/** The menu's choices: how the list groups, Creator only where the workspace is shared, how it orders, and whose tasks it lists, where shared. */
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
              items: createdByEntries(control, reader),
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
          groups={viewEntries(control, shared, reader)}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/**
 * The chip under the Tasks head while the list holds one member's tasks:
 * their face and "Created by me" or "Created by" their name, and an × that
 * lists everyone's again.
 */
export function CreatedByChip({
  createdBy,
  plans,
  onClear,
}: {
  createdBy: string;
  /** The listed tasks, which name a creator the members no longer list. */
  plans: readonly PlanSummary[];
  onClear: () => void;
}): React.JSX.Element {
  const reader = useMemberDirectory();
  const actor = filteredActor(createdBy, reader, plans);
  const words = createdBy === reader.readerId ? "Created by me" : `Created by ${actorName(actor)}`;
  return (
    <div className="sidebar-view-chips">
      <span className="sidebar-view-chip">
        <ActorMark actor={actor} size={ACTOR_SIZE.MARK} />
        <span className="sidebar-view-chip-words">{words}</span>
        <Tooltip label="Show everyone's tasks">
          <button type="button" aria-label="Show everyone's tasks" onClick={onClear}>
            <XIcon />
          </button>
        </Tooltip>
      </span>
    </div>
  );
}
