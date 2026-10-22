import { EllipsisIcon } from "@luke/ui";
import { TASKS_PAGE } from "@luke/ui/tasks-model";
import { InboxIcon, ListTodoIcon, MessagesSquareIcon } from "lucide-react";
import type { ReactNode } from "react";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { SIDEBAR_OVERLAY, type SidebarCollapse } from "./sidebar-collapse.js";

/**
 * mobile-bar.tsx -- a phone's way between the window's places: a bar at the
 * screen's foot with the Inbox, the Tasks page, Chat where the account has
 * it, and More, which opens the sidebar's drawer for everything else.
 *
 * It stands only in a narrow room and only on a place's list, the Inbox's,
 * the Tasks page, Chat's rail, Automations, or the window resting with no
 * task open, so a task, an agent's page, an item, or a channel being read
 * keeps the whole screen and is left by Back. The Inbox's press lands on its
 * list, not on the item last read, since on a phone the list is the place.
 */

/** Whether the bar stands: a narrow room, signed in, on one of the places' lists. */
export function mobileBarShown(room: ShellRoom, tasks: TasksControl, chatOn: boolean): boolean {
  if (room !== SHELL_ROOM.NARROW || !tasks.signedIn || tasks.sidePanel.fullScreen) return false;
  const { inboxView, chatView, boardView, automationsView, agentView, personView } = tasks;
  if (chatView.open && chatOn) return chatView.listed;
  if (inboxView.open) return inboxView.listed || inboxView.chosen === undefined;
  if (agentView.agentId !== undefined || personView.userId !== undefined) return false;
  if (boardView.open || automationsView.open) return true;
  return tasks.page === TASKS_PAGE.HOME;
}

/** The bar; see the module's head. */
export function MobileBar({
  tasks,
  chatOn,
  sidebar,
  onPressMore,
}: {
  tasks: TasksControl;
  chatOn: boolean;
  sidebar: SidebarCollapse;
  /** Marks the press on More as the drawer's own, so the press that opens it does not also put it away. */
  onPressMore: () => void;
}): React.JSX.Element {
  const { inboxView, chatView, boardView } = tasks;
  const inChat = chatView.open && chatOn;
  const inInbox = !inChat && inboxView.open;
  const inTasks = !inChat && !inInbox && boardView.open;
  const openInbox = () => {
    inboxView.onOpen();
    inboxView.onListed(true);
  };
  return (
    <nav className="mobile-bar" aria-label="Places">
      <MobileBarItem icon={<InboxIcon />} current={inInbox} onPress={openInbox}>
        Inbox
      </MobileBarItem>
      <MobileBarItem icon={<ListTodoIcon />} current={inTasks} onPress={boardView.onOpen}>
        Tasks
      </MobileBarItem>
      {chatOn && chatView.available ? (
        <MobileBarItem icon={<MessagesSquareIcon />} current={inChat} onPress={chatView.onOpen}>
          Chat
        </MobileBarItem>
      ) : null}
      <MobileBarItem
        icon={<EllipsisIcon />}
        current={false}
        expanded={sidebar.overlay === SIDEBAR_OVERLAY.OPEN}
        onPointerDown={onPressMore}
        onPress={sidebar.onToggle}
      >
        More
      </MobileBarItem>
    </nav>
  );
}

function MobileBarItem({
  icon,
  current,
  expanded,
  onPointerDown,
  onPress,
  children,
}: {
  icon: ReactNode;
  current: boolean;
  expanded?: boolean;
  onPointerDown?: () => void;
  onPress: () => void;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="mobile-bar-item"
      aria-current={current ? "page" : undefined}
      aria-expanded={expanded}
      onPointerDown={onPointerDown}
      onClick={onPress}
    >
      <span className="mobile-bar-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </button>
  );
}
