import { BarItem, EllipsisIcon } from "@luke/ui";
import { TASKS_PAGE } from "@luke/ui/tasks-model";
import { InboxIcon, ListTodoIcon, MessagesSquareIcon } from "lucide-react";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { automationsTab, type TasksControl } from "../tasks/use-tasks-tab.js";
import { needsYouNoun, usePlacesWaiting } from "./places-waiting.js";
import { SIDEBAR_OVERLAY, type SidebarCollapse } from "./sidebar-collapse.js";

/**
 * mobile-bar.tsx -- a phone's way between the window's places: a bar at the
 * screen's foot with the Inbox, the Tasks page, Chat where the account has
 * it, and More, which opens the sidebar's drawer for everything else.
 *
 * It stands only in a narrow room and only on a place's list, the Inbox's,
 * the Tasks page, Chat's rail, Automations, or the window resting with no
 * task open, so a task, an agent's page, an item, or a channel being read
 * keeps the whole screen and is left by Back. Each press lands on its
 * place's list, not on the item or channel last read, since on a phone the
 * list is the place (`use-tasks-tab.ts`'s `onOpen`).
 *
 * Settings, which stands over the places rather than among them, keeps the
 * bar on a phone too, its list and its pages alike: no place is the current
 * one there, and a press leaves Settings for the place pressed, More for the
 * drawer over the places (`leave`).
 *
 * The Inbox and Chat each count what waits on the developer there, the
 * count the drawer's rows show, read from the one reading they draw from
 * (`places-waiting.ts`), so the two never disagree, and said in the
 * sidebar's words.
 */

/** Whether the bar stands: a narrow room, signed in, on one of the places' lists. */
export function mobileBarShown(room: ShellRoom, tasks: TasksControl, chatOn: boolean): boolean {
  // Note that the open task's side panel is not asked: it is held behind every place, so it says nothing of the one on screen.
  if (room !== SHELL_ROOM.NARROW || !tasks.signedIn) return false;
  const { inboxView, chatView, boardView, automationsView, agentView, personView } = tasks;
  if (chatView.open && chatOn) return chatView.listed;
  if (inboxView.open) return inboxView.listed || inboxView.chosen === undefined;
  if (agentView.agentId !== undefined || personView.userId !== undefined) return false;
  if (boardView.open) return true;
  // Note that an automation's editor and its runs keep the whole screen, as an item does; only the list and the Runs tab stand over the bar.
  if (automationsView.open) return automationsTab(automationsView.place);
  return tasks.page === TASKS_PAGE.HOME;
}

/** The bar; see the module's head. */
export function MobileBar({
  tasks,
  chatOn,
  sidebar,
  onPressMore,
  leave,
}: {
  tasks: TasksControl;
  chatOn: boolean;
  /** The drawer the bar's More opens, whose float while open leaves every other item inert, as the work it covers is. */
  sidebar: SidebarCollapse;
  /** Marks the press on More as the drawer's own, so the press that opens it does not also put it away. */
  onPressMore: () => void;
  /** Leaves what stands over the places (Settings) before a press opens one; none where the bar stands among them. */
  leave?: (() => void) | undefined;
}): React.JSX.Element {
  const { inboxView, chatView, boardView } = tasks;
  const among = leave === undefined;
  const inChat = among && chatView.open && chatOn;
  const inInbox = among && !inChat && inboxView.open;
  const inTasks = among && !inChat && !inInbox && boardView.open;
  const drawerOpen = sidebar.overlay !== SIDEBAR_OVERLAY.CLOSED;
  const waiting = usePlacesWaiting(tasks);
  // Note that a press leaves what stands over the places first, so the place it opens is the one on screen.
  const go = (open: () => void) => () => {
    leave?.();
    open();
  };
  return (
    <nav
      className="mobile-bar flex border-t border-border bg-ground px-luke-4 py-luke-2"
      aria-label="Places"
    >
      <BarItem
        icon={<InboxIcon />}
        current={inInbox}
        count={{ value: waiting.inbox, noun: needsYouNoun(waiting.inbox) }}
        inert={drawerOpen}
        onPress={go(inboxView.onOpen)}
      >
        Inbox
      </BarItem>
      <BarItem
        icon={<ListTodoIcon />}
        current={inTasks}
        inert={drawerOpen}
        onPress={go(boardView.onOpen)}
      >
        Tasks
      </BarItem>
      {chatOn && chatView.available ? (
        <BarItem
          icon={<MessagesSquareIcon />}
          current={inChat}
          count={{ value: waiting.chat, noun: needsYouNoun(waiting.chat) }}
          inert={drawerOpen}
          onPress={go(chatView.onOpen)}
        >
          Chat
        </BarItem>
      ) : null}
      <BarItem
        icon={<EllipsisIcon />}
        current={false}
        expanded={sidebar.overlay === SIDEBAR_OVERLAY.OPEN}
        onPointerDown={onPressMore}
        onPress={go(sidebar.onToggle)}
      >
        More
      </BarItem>
    </nav>
  );
}
