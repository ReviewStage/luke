import type { TaskStanding } from "@repo/features/task-wire";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { BUTTON_SIZE, ComposeIcon, IconButton, PlusIcon, Tooltip } from "@repo/ui";
import { TASKS_GROUP, type TasksGroupHead } from "@repo/ui/tasks-page-model";
import type { QuickAddInto, TasksControl } from "../tasks/use-tasks-tab.js";

export function groupNewTaskWords(head: TasksGroupHead, words: string): string {
  if (head.kind !== TASKS_GROUP.ASSIGNEE) return `New task in ${words}`;
  return head.assigneeId === null ? "New unassigned task" : `New task for ${words}`;
}

export function groupStanding(head: TasksGroupHead): TaskStanding | undefined {
  if (head.kind === TASKS_GROUP.STATUS) return { status: head.status };
  if (head.kind === TASKS_GROUP.PRIORITY) return { priority: head.priority };
  if (head.kind === TASKS_GROUP.ASSIGNEE) return { assigneeId: head.assigneeId };
  return undefined;
}

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

export function quickAddInto(head: TasksGroupHead): QuickAddInto | undefined {
  if (head.kind === TASKS_GROUP.REPOSITORY) {
    return head.repository === null ? undefined : { repository: head.repository };
  }
  const standing = groupStanding(head);
  return standing === undefined ? undefined : { standing };
}
