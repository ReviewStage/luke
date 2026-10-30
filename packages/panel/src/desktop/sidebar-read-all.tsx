import type { DrawnMenu } from "@luke/ui";
import { CheckCheckIcon } from "@luke/ui/icons";
import { useMemo } from "react";
import { useAct } from "../act.js";
import { channelGroups, isUnread } from "../tasks/inbox-model.js";
import { type InboxReadMarks, useInboxReadMarks } from "../tasks/use-inbox-read-marks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useListedInboxGroups } from "../tasks/use-waiting-items.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";

/**
 * sidebar-read-all.tsx -- Mark all as read in the menu a right-click opens on the sidebar's Inbox row and on each channel's row.
 *
 * The sidebar holds what waits on the reader alone, which says nothing of
 * what is unread, so the menu reads the listed workspace's items from the
 * account's feed as the window's Inbox reads them (`useListedInboxGroups`),
 * and only while it stands open, so no read is held for a menu nobody
 * opened. Mark all as read stands disabled while nothing it would mark is
 * unread, and until the feed first answers. On the Inbox's row it marks
 * every unread thread of the listed workspace, as the service marks the
 * workspace's whole (`onMarkAll`); on a channel's, that channel's threads
 * alone, each on its own (`onMarkEach`), since the service marks no
 * channel's whole.
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
 * workspace, or of the channel `channelId` names. Draw it only while the
 * menu is drawn, since it reads the account's feed while it stands.
 */
export function ReadAllMenu({
  readAll,
  channelId,
  label,
  menu,
  groups,
  onClose,
}: {
  readAll: SidebarReadAll;
  /** The channel whose threads it marks; none on the Inbox's row, which marks every one. */
  channelId?: string | undefined;
  label: string;
  menu: DrawnMenu;
  /** The menu's groups, Mark all as read among them where the row keeps it. */
  groups: (markAll: MenuAction) => readonly (readonly MenuAction[])[];
  onClose: (returnFocus: boolean) => void;
}): React.JSX.Element {
  const { groups: listed } = useListedInboxGroups(readAll.tasks);
  const held = channelId === undefined ? listed : channelGroups(listed, channelId, undefined);
  const unread = held.flatMap(({ items }) => items).filter(isUnread);
  const { onMarkAll, onMarkEach } = readAll.marks;
  const markAll: MenuAction = {
    label: MARK_ALL_READ,
    icon: <CheckCheckIcon />,
    disabled: unread.length === 0,
    onSelect: () => (channelId === undefined ? onMarkAll : onMarkEach)(unread),
  };
  return <ActionMenu label={label} menu={menu} groups={groups(markAll)} onClose={onClose} />;
}
