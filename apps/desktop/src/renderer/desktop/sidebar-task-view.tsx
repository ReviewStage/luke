import { TASK_GROUPING, TASK_ORDER } from "@luke/ui/task-list-model";
import {
  ArrowDownAZIcon,
  CalendarPlusIcon,
  ClockIcon,
  FolderGitIcon,
  ListIcon,
  SlidersHorizontalIcon,
  UserIcon,
} from "lucide-react";
import type { ReactNode } from "react";
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
 * checked.
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

/** The menu's choices: how the list groups, Creator only where the workspace is shared, and how it orders. */
function viewEntries(control: TaskListViewControl, shared: boolean): MenuEntry[][] {
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
}: {
  /** Whether the sidebar is on screen, for the menu not to outlive it. */
  shown: boolean;
  control: TaskListViewControl;
  /** Whether the workspace is shared, which alone groups by creator. */
  shared: boolean;
}): React.JSX.Element {
  const menu = useActionMenu(shown);
  return (
    <>
      <Tooltip label={VIEW_OPTIONS}>
        <button
          type="button"
          className="icon-button sidebar-view-options"
          aria-label={VIEW_OPTIONS}
          {...menu.trigger()}
        >
          <SlidersHorizontalIcon className="icon-button-glyph" />
        </button>
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={VIEW_OPTIONS}
          menu={menu.drawn}
          groups={viewEntries(control, shared)}
          onClose={menu.close}
        />
      )}
    </>
  );
}
