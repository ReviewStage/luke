import { APP_COMMAND } from "@repo/settings/shortcuts";
import { BarAction, BarItem, BarItems, MENU_KEEPS_CLEAR, PlusIcon, SearchIcon } from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { TASKS_PAGE } from "@repo/ui/tasks-model";
import { InboxIcon, ListTodoIcon } from "lucide-react";
import { adminSection } from "../admin/routing.js";
import { runAppCommand } from "../app-commands.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { NEEDS_YOU } from "../tasks/inbox-model.js";
import { automationsTab, type TasksControl } from "../tasks/use-tasks-tab.js";
import { useInboxWaiting } from "./places-waiting.js";
import { SIDEBAR_OVERLAY, type SidebarCollapse } from "./sidebar-collapse.js";
import { groupCount } from "./sidebar-fold.js";

/**
 * mobile-bar.tsx -- a phone's way between the window's places: a bar
 * floating at the screen's foot with the Inbox, Tasks, and Search in one
 * pill, and New task beside it, as a phone's own apps float their tabs
 * beside a compose button.
 *
 * The Inbox is a phone's first place, the one it opens on
 * (`navigation-history.ts`). Tasks is the sidebar's tree of tasks, the
 * pinned and each section, drawn as the drawer the sidebar is on a phone
 * but spanning the screen above the bar, which stays live over it, so a
 * phone browses its tasks as a list sized for a finger rather than the
 * Tasks page's list or board, which its Tasks row still opens. Search
 * opens the command palette, as the sidebar's Search does, and New task the
 * New task dialog.
 *
 * It stands only in a narrow room and only on a place's list, the Inbox's,
 * the Tasks page, Automations, or Home, so a task, an agent's page, or an
 * item being read keeps the whole screen and is left by Back. Each press
 * lands on its place's list, not on the item last read, since on a phone the
 * list is the place (`use-tasks-tab.ts`'s `onOpen`).
 *
 * Settings, which stands over the places rather than among them, keeps the
 * bar on a phone too, its list and its pages alike: no place is the current
 * one there, and a press leaves Settings for the place pressed (`leave`).
 *
 * The Inbox counts what waits on the developer there, the count the
 * drawer's row shows, read from the one reading they draw from
 * (`places-waiting.ts`), so the two never disagree, and said in the
 * sidebar's words.
 */

/** Whether the bar stands: a narrow room, signed in, on one of the places' lists. */
export function mobileBarShown(room: ShellRoom, tasks: TasksControl): boolean {
  // Note that the open task's side panel is not asked: it is held behind every place, so it says nothing of the one on screen.
  if (room !== SHELL_ROOM.NARROW || !tasks.signedIn) return false;
  const { inboxView, boardView, automationsView, adminView, agentView, personView } = tasks;
  if (inboxView.open) return inboxView.chosen === undefined;
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
  onPressTasks,
  leave,
}: {
  tasks: TasksControl;
  /** The drawer Tasks opens, the sidebar's tree. */
  sidebar: SidebarCollapse;
  /** Marks the press on Tasks as the drawer's own, so the press that opens it does not also put it away. */
  onPressTasks: () => void;
  /** Leaves what stands over the places (Settings) before a press opens one; none where the bar stands among them. */
  leave?: (() => void) | undefined;
}): React.JSX.Element {
  const { inboxView, boardView } = tasks;
  const among = leave === undefined;
  const treeShown = sidebar.overlay === SIDEBAR_OVERLAY.OPEN;
  const inInbox = among && !treeShown && inboxView.open;
  const inTasks = treeShown || (among && !inboxView.open && boardView.open);
  const waiting = useInboxWaiting(tasks);
  // Note that a press leaves what stands over the places first, so the place it opens is the one on screen,
  // and puts the tree away, which stands over every place but its own.
  const go = (open: () => void) => () => {
    leave?.();
    sidebar.onOverlay(SIDEBAR_OVERLAY.CLOSED);
    open();
  };
  return (
    <nav
      className="mobile-bar flex items-center gap-ui-12 bg-ground px-ui-12 py-ui-8"
      aria-label="Places"
      {...MENU_KEEPS_CLEAR}
    >
      <ReplayUnmask>
        <BarItems>
          <BarItem
            icon={<InboxIcon />}
            current={inInbox}
            count={groupCount(waiting, NEEDS_YOU.COUNT)}
            onPress={go(inboxView.onOpen)}
          >
            Inbox
          </BarItem>
          <BarItem
            icon={<ListTodoIcon />}
            current={inTasks}
            onPointerDown={onPressTasks}
            onPress={() => {
              leave?.();
              sidebar.onOverlay(SIDEBAR_OVERLAY.OPEN);
            }}
          >
            Tasks
          </BarItem>
          <BarItem
            icon={<SearchIcon />}
            onPress={go(() => runAppCommand(APP_COMMAND.COMMAND_PALETTE))}
          >
            Search
          </BarItem>
        </BarItems>
        <BarAction
          icon={<PlusIcon />}
          label="New task"
          disabled={!tasks.signedIn}
          onPress={go(tasks.onNewTask)}
        />
      </ReplayUnmask>
    </nav>
  );
}
