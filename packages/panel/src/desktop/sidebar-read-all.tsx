import type { DrawnMenu } from "@repo/ui";
import { CheckCheckIcon } from "@repo/ui/icons";
import { useMemo } from "react";
import { useAct } from "../act.js";
import { isUnread } from "../tasks/inbox-model.js";
import { type InboxReadMarks, useInboxReadMarks } from "../tasks/use-inbox-read-marks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useListedInboxGroups } from "../tasks/use-waiting-items.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";

/**
 * sidebar-read-all.tsx -- Mark all as read in the menu a right-click opens on the sidebar's Inbox row.
 *
 * The sidebar holds what waits on the reader alone, which says nothing of
 * what is unread, so the menu reads the listed workspace's items from the
 * account's feed as the window's Inbox reads them (`useListedInboxGroups`),
 * and only while it stands open, so no read is held for a menu nobody
 * opened. Mark all as read stands disabled while nothing it would mark is
 * unread, and until the feed answers for every holder the listed workspace
 * holds, which the menu's own groups are told (`ready`). It marks every
 * unread thread of the listed workspace, as the service marks the
 * workspace's whole (`onMarkAll`).
 */

/** What the menus offer to clear every dot with. */
const MARK_ALL_READ = "Mark all as read";

/** What the sidebar's menus mark with: the listed workspace's tasks, and the Inbox's read marks over it. */
export interface SidebarReadAll {
  readonly tasks: TasksControl;
  readonly marks: InboxReadMarks;
}

/** The sidebar's read marks, over the listed workspace. */
export function useSidebarReadAll(tasks: TasksControl): SidebarReadAll {
  const { act } = useAct();
  const marks = useInboxReadMarks({ act, workspaceId: tasks.workspace?.id });
  return useMemo(() => ({ tasks, marks }), [tasks, marks]);
}

/**
 * A row's menu holding Mark all as read: every unread thread of the listed
 * workspace. Draw it only while the
 * menu is drawn, since it reads the account's feed while it stands.
 */
export function ReadAllMenu({
  readAll,
  label,
  menu,
  groups,
  onClose,
}: {
  readAll: SidebarReadAll;
  label: string;
  menu: DrawnMenu;
  /** The menu's groups, Mark all as read among them where the row keeps it, and whether the feed has answered for every thread it would mark. */
  groups: (markAll: MenuAction, ready: boolean) => readonly (readonly MenuAction[])[];
  onClose: (returnFocus: boolean) => void;
}): React.JSX.Element {
  const { groups: listed, read } = useListedInboxGroups(readAll.tasks);
  const ready = !read.pending && !read.failed;
  const unread = listed.flatMap(({ items }) => items).filter(isUnread);
  const { onMarkAll } = readAll.marks;
  const markAll: MenuAction = {
    label: MARK_ALL_READ,
    icon: <CheckCheckIcon />,
    disabled: !ready || unread.length === 0,
    onSelect: () => onMarkAll(unread),
  };
  return (
    <ActionMenu
      label={label}
      menu={menu}
      groups={groups(markAll, ready)}
      onClose={onClose}
      replayUnmasked
    />
  );
}
