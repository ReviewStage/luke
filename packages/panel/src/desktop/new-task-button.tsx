import type { TaskStanding } from "@luke/features/task-wire";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { BUTTON_SIZE, ComposeIcon, IconButton, PlusIcon, Tooltip } from "@luke/ui";
import { TASKS_GROUP, type TasksGroupHead } from "@luke/ui/tasks-page-model";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * new-task-button.tsx -- New task as a glyph: the title bar's while the sidebar is folded, and the start corner of a phone's Inbox and Tasks page (`phone-head.tsx`), opening New task's dialog; and a group's +, a sidebar repository's or a Tasks page group's, opening it on what the group stands for.
 */

/** What a Tasks page group's + names, to a reader, for the task it starts: one in a status, priority, or repository, or for a person. */
function groupNewTaskWords(head: TasksGroupHead, words: string): string {
  if (head.kind !== TASKS_GROUP.ASSIGNEE) return `New task in ${words}`;
  return head.assigneeId === null ? "New unassigned task" : `New task for ${words}`;
}

/** What a task dropped on a group, or started from its +, is sent: the group's status or priority, or its assignee, null for No assignee's; nothing for a group that stands for none of them. */
export function groupStanding(head: TasksGroupHead): TaskStanding | undefined {
  if (head.kind === TASKS_GROUP.STATUS) return { status: head.status };
  if (head.kind === TASKS_GROUP.PRIORITY) return { priority: head.priority };
  if (head.kind === TASKS_GROUP.ASSIGNEE) return { assigneeId: head.assigneeId };
  return undefined;
}

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

/** A group's +, at its head's end, named for the task it starts: New task's dialog on what the group stands for. */
export function NewTaskInButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Tooltip label={label}>
      <IconButton icon={<PlusIcon />} label={label} size={BUTTON_SIZE.COMPACT} onClick={onPress} />
    </Tooltip>
  );
}

/**
 * A Tasks page group's +, a List group's or a Board column's: New task's
 * dialog with the group's status, priority, or assignee already chosen, or
 * its repository, so the task started lands in the group it was asked from.
 * Nothing for a group that stands for none of them, pinned tasks, a
 * section, or a creator, nor while no one is signed in.
 */
export function GroupNewTaskButton({
  tasks,
  head,
  words,
}: {
  tasks: TasksControl;
  head: TasksGroupHead;
  /** What the group is headed by, which the button and the dialog's pill say. */
  words: string;
}): React.JSX.Element | null {
  if (!tasks.signedIn) return null;
  const label = groupNewTaskWords(head, words);
  if (head.kind === TASKS_GROUP.REPOSITORY) {
    const { repository } = head;
    if (repository === null) return null;
    return <NewTaskInButton label={label} onPress={() => tasks.onNewTaskIn(repository)} />;
  }
  const asked = groupStanding(head);
  if (asked === undefined) return null;
  return <NewTaskInButton label={label} onPress={() => tasks.onNewTaskAt({ asked, words })} />;
}
