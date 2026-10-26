import { BarItem, EllipsisIcon, MENU_KEEPS_CLEAR } from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { TASKS_PAGE } from "@luke/ui/tasks-model";
import { ListTodoIcon } from "lucide-react";
import { adminSection } from "../admin/routing.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { channelsWaiting } from "../tasks/channels-model.js";
import { useChannels } from "../tasks/use-channels.js";
import { automationsTab, type TasksControl } from "../tasks/use-tasks-tab.js";
import { needsYouNoun } from "./places-waiting.js";
import { SIDEBAR_OVERLAY, type SidebarCollapse } from "./sidebar-collapse.js";

/**
 * mobile-bar.tsx -- a phone's way between the window's places: a bar at the
 * screen's foot with Channels, the Tasks page, and More, which opens the
 * sidebar's drawer for everything else.
 *
 * It stands only in a narrow room and only on a place's list, the list of
 * channels or a channel's stream, the Tasks page, Automations, or the window
 * resting with no task open, so a task, an agent's page, or a thread being
 * read keeps the whole screen and is left by Back. Each press lands on its
 * place's list, not on the thread or channel last read, since on a phone the
 * list is the place (`use-tasks-tab.ts`'s `onOpen`).
 *
 * Settings, which stands over the places rather than among them, keeps the
 * bar on a phone too, its list and its pages alike: no place is the current
 * one there, and a press leaves Settings for the place pressed, More for the
 * drawer over the places (`leave`).
 *
 * Channels counts the open asks that wait on the developer, every
 * channel's summed, as the sidebar counts each.
 */

/** Whether the bar stands: a narrow room, signed in, on one of the places' lists, a thread standing over its channel's stream only while `threadId` names it. */
export function mobileBarShown(
  room: ShellRoom,
  tasks: TasksControl,
  threadId: string | undefined,
): boolean {
  // Note that the open task's side panel is not asked: it is held behind every place, so it says nothing of the one on screen.
  if (room !== SHELL_ROOM.NARROW || !tasks.signedIn) return false;
  const { inboxView, boardView, automationsView, adminView, agentView, personView } = tasks;
  // Note that a thread stands over a channel's stream only while its item is the one chosen, so a choice history went back past shows the stream.
  const chosen = inboxView.chosen;
  const itemStands = chosen !== undefined && threadId === chosen.itemId;
  if (inboxView.open) return inboxView.listed || !itemStands;
  if (agentView.agentId !== undefined || personView.userId !== undefined) return false;
  if (boardView.open) return true;
  // Note that an automation's editor and its runs keep the whole screen, as an item does; only the list and the Runs tab stand over the bar.
  if (automationsView.open) return automationsTab(automationsView.place);
  // So does Admin: a section stands over the bar, an account's or a day's page under one keeps the whole screen.
  if (adminView.open) return adminSection(adminView.view);
  return tasks.page === TASKS_PAGE.HOME;
}

/** The bar; see the module's head. */
export function MobileBar({
  tasks,
  sidebar,
  onPressMore,
  leave,
}: {
  tasks: TasksControl;
  /** The drawer the bar's More opens, whose float while open leaves every other item inert, as the work it covers is. */
  sidebar: SidebarCollapse;
  /** Marks the press on More as the drawer's own, so the press that opens it does not also put it away. */
  onPressMore: () => void;
  /** Leaves what stands over the places (Settings) before a press opens one; none where the bar stands among them. */
  leave?: (() => void) | undefined;
}): React.JSX.Element {
  const { inboxView, boardView } = tasks;
  const among = leave === undefined;
  const inInbox = among && inboxView.open;
  const inTasks = among && !inInbox && boardView.open;
  const drawerOpen = sidebar.overlay !== SIDEBAR_OVERLAY.CLOSED;
  // Note that a press leaves what stands over the places first, so the place it opens is the one on screen.
  const go = (open: () => void) => () => {
    leave?.();
    open();
  };
  // Note that the bar reads nothing itself: the sidebar, held behind the drawer, reads the channels as the window comes into view, and the bar draws what it holds.
  const channels = useChannels(tasks.workspace?.id, false);
  const channelsCount = channelsWaiting(channels.channels ?? []);
  return (
    <nav
      className="mobile-bar flex border-t border-border bg-ground px-luke-4 py-luke-2"
      aria-label="Places"
      {...MENU_KEEPS_CLEAR}
    >
      <BarItem
        icon={<GLYPH.CHANNEL />}
        current={inInbox}
        count={{ value: channelsCount, noun: needsYouNoun(channelsCount) }}
        inert={drawerOpen}
        onPress={go(inboxView.onOpen)}
      >
        Channels
      </BarItem>
      <BarItem
        icon={<ListTodoIcon />}
        current={inTasks}
        inert={drawerOpen}
        onPress={go(boardView.onOpen)}
      >
        Tasks
      </BarItem>
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
