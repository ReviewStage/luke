import { APP_COMMAND } from "@luke/settings/shortcuts";
import { ComposeIcon, IconButton, Tooltip } from "@luke/ui";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * new-task-button.tsx -- New task as a glyph: the title bar's while the sidebar is folded, and the start corner of a phone's Inbox and Tasks page (`phone-head.tsx`), opening New task's dialog.
 */

/**
 * New task's glyph, kept in reach where the sidebar's own button is not: it
 * asks for exactly what the sidebar's button asks for, the New task dialog,
 * over whatever stands, the way a chat app keeps its compose button in reach.
 * Pressed by nothing while no one is signed in.
 */
export function NewTaskButton({ tasks }: { tasks: TasksControl }): React.JSX.Element {
  return (
    <Tooltip label="New task" command={APP_COMMAND.NEW_TASK}>
      <IconButton
        icon={<ComposeIcon />}
        label="New task"
        disabled={!tasks.signedIn}
        onClick={tasks.onNewTask}
      />
    </Tooltip>
  );
}
