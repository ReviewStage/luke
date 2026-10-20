import {
  TASK_PRIORITY,
  TASK_PRIORITY_ORDER,
  TASK_STATUS,
  TASK_STATUS_ORDER,
  type Task,
  type TaskPriority,
  type TaskStanding,
  type TaskStatus,
} from "@luke/features/task-wire";
import { taskKey } from "@luke/features/workspace-key";
import {
  CHIP_WIDTH,
  GAP,
  Inline,
  TaskPriorityMark,
  TaskStatusMark,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import type { MenuRow } from "../searchable-menu.js";
import { PICKER_ALIGN, Picker } from "../settings/picker-row.js";

/**
 * task-standing.tsx -- a task's key over its name, and the chips under it that say and change where it stands and how much it matters.
 *
 * The key is the task's workspace prefix and its number (`ACME-42`), drawn
 * small in monospace above the title, as the task's own page names it. Under
 * the title stand two chips, each dropping the window's own menu
 * (`picker-row.tsx`): the status, each of the five with its mark, and the
 * priority, each with its bars. A pick is handed back for the page to send;
 * without a door to send it, as on an archived task, the chips only say.
 * A task from a service before statuses has no key and no chips.
 */

/** Each status as its chip, its menu's row, the Board's column, and the sidebar's filter say it. */
export const TASK_STATUS_WORDS = {
  [TASK_STATUS.BACKLOG]: "Backlog",
  [TASK_STATUS.TODO]: "Todo",
  [TASK_STATUS.IN_PROGRESS]: "In progress",
  [TASK_STATUS.DONE]: "Done",
  [TASK_STATUS.CANCELED]: "Canceled",
} as const satisfies Record<TaskStatus, string>;

/** Each priority as its chip and its menu's row say it. */
const TASK_PRIORITY_WORDS = {
  [TASK_PRIORITY.NONE]: "No priority",
  [TASK_PRIORITY.URGENT]: "Urgent",
  [TASK_PRIORITY.HIGH]: "High",
  [TASK_PRIORITY.MEDIUM]: "Medium",
  [TASK_PRIORITY.LOW]: "Low",
} as const satisfies Record<TaskPriority, string>;

const STATUS_ROWS: readonly MenuRow[] = TASK_STATUS_ORDER.map((status) => ({
  id: status,
  label: TASK_STATUS_WORDS[status],
  icon: <TaskStatusMark status={status} />,
}));

const PRIORITY_ROWS: readonly MenuRow[] = TASK_PRIORITY_ORDER.map((priority) => ({
  id: priority,
  label: TASK_PRIORITY_WORDS[priority],
  icon: <TaskPriorityMark priority={priority} />,
}));

/** The status a picked row names; none for a row that names no status. */
function statusOf(id: string): TaskStatus | undefined {
  return TASK_STATUS_ORDER.find((status) => status === id);
}

/** The priority a picked row names; none for a row that names no priority. */
function priorityOf(id: string): TaskPriority | undefined {
  return TASK_PRIORITY_ORDER.find((priority) => priority === id);
}

/** What the page hands the task's head: its workspace's name, which the key is drawn from, and the door a pick is sent through, none where the task takes no change. */
export interface TaskStandingDoor {
  readonly workspaceName: string;
  readonly onSet?: ((standing: TaskStanding) => void) | undefined;
}

/** The task's key, small and monospace, over its title; nothing for a task from a service before keys. */
export function TaskKeyLine({
  task,
  workspaceName,
}: {
  task: Task;
  workspaceName: string;
}): React.JSX.Element | null {
  if (task.number === undefined) return null;
  return (
    <div className="plan-task-key">
      <Text
        variant={TEXT_VARIANT.CAPTION}
        tone={TEXT_TONE.SUBTLE}
        font={TEXT_FONT.MONO}
        as={TEXT_ELEMENT.SPAN}
      >
        {taskKey(workspaceName, task.number)}
      </Text>
    </div>
  );
}

/** The task's status and priority chips, under its title; nothing for a task from a service before them. */
export function TaskStandingChips({
  task,
  onSet,
}: {
  task: Task;
  onSet: ((standing: TaskStanding) => void) | undefined;
}): React.JSX.Element | null {
  const { status, priority } = task;
  if (status === undefined || priority === undefined) return null;
  return (
    <div className="plan-task-standing">
      <Inline gap={GAP.CONTROL}>
        <Picker
          label="Status"
          value={status}
          valueLabel={TASK_STATUS_WORDS[status]}
          valueIcon={<TaskStatusMark status={status} />}
          rows={STATUS_ROWS}
          noMatch="No such status"
          align={PICKER_ALIGN.START}
          width={CHIP_WIDTH.AUTO}
          disabled={onSet === undefined}
          onPick={(id) => {
            const picked = statusOf(id);
            if (picked !== undefined && picked !== status) onSet?.({ status: picked });
          }}
        />
        <Picker
          label="Priority"
          value={priority}
          valueLabel={TASK_PRIORITY_WORDS[priority]}
          valueIcon={<TaskPriorityMark priority={priority} />}
          rows={PRIORITY_ROWS}
          noMatch="No such priority"
          align={PICKER_ALIGN.START}
          width={CHIP_WIDTH.AUTO}
          disabled={onSet === undefined}
          onPick={(id) => {
            const picked = priorityOf(id);
            if (picked !== undefined && picked !== priority) onSet?.({ priority: picked });
          }}
        />
      </Inline>
    </div>
  );
}
