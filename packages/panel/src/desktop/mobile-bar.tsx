import { APP_COMMAND } from "@repo/settings/shortcuts";
import { BarAction, BarItem, BarItems, MENU_KEEPS_CLEAR, PlusIcon, SearchIcon } from "@repo/ui";
import { raiseKeyboard } from "@repo/ui/command";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { TASKS_PAGE } from "@repo/ui/tasks-model";
import { InboxIcon, ListTodoIcon } from "lucide-react";
import { adminSection } from "../admin/routing.js";
import { runAppCommand } from "../app-commands.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { NEEDS_YOU } from "../tasks/inbox-model.js";
import { automationsTab, type TasksControl } from "../tasks/use-tasks-tab.js";
import { useInboxWaiting } from "./places-waiting.js";
import { groupCount } from "./sidebar-fold.js";

export function mobileBarShown(room: ShellRoom, tasks: TasksControl): boolean {
  if (room !== SHELL_ROOM.NARROW || !tasks.signedIn) return false;
  const { inboxView, boardView, automationsView, adminView, agentView, personView } = tasks;
  if (inboxView.open) return inboxView.chosen === undefined;
  if (agentView.agentId !== undefined || personView.userId !== undefined) return false;
  if (boardView.open) return true;
  if (automationsView.open) return automationsTab(automationsView.place);
  if (adminView.open) return adminSection(adminView.view);
  return tasks.page === TASKS_PAGE.HOME;
}

export function MobileBar({
  tasks,
  leave,
}: {
  tasks: TasksControl;
  leave?: (() => void) | undefined;
}): React.JSX.Element {
  const { inboxView, boardView } = tasks;
  const among = leave === undefined;
  const inInbox = among && inboxView.open;
  const inTasks = among && !inInbox && boardView.open;
  const waiting = useInboxWaiting(tasks);
  const go = (open: () => void) => () => {
    leave?.();
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
          <BarItem icon={<ListTodoIcon />} current={inTasks} onPress={go(boardView.onOpen)}>
            Tasks
          </BarItem>
          <BarItem
            icon={<SearchIcon />}
            onPress={go(() => {
              raiseKeyboard();
              runAppCommand(APP_COMMAND.COMMAND_PALETTE);
            })}
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
