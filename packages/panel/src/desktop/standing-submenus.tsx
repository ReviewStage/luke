import { TASK_STATUS, TASK_STATUS_ORDER, type TaskStatus } from "@repo/features/task-wire";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { type MenuRow, TaskStatusMark } from "@repo/ui";
import { STATUS_ROWS } from "../tasks/task-standing.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import type { MenuAction, MenuSubmenu } from "./action-menu.js";

export const STANDING_WORDS = {
  STATUS: "Status",
  PRIORITY: "Priority",
  ASSIGNEE: "Assignee",
} as const;

export function chipSubmenu(
  label: string,
  rows: readonly MenuRow[],
  value: string | undefined,
  onPick: (id: string) => void,
  icon?: React.JSX.Element,
): MenuSubmenu {
  const items = rows.map(
    (row): MenuAction => ({
      label: row.label,
      icon: <>{row.icon}</>,
      ...(typeof row.detail === "string" ? { detail: row.detail } : {}),
      ...(row.card === undefined ? {} : { card: row.card }),
      checked: row.id === value,
      onSelect: () => {
        if (row.id !== value) onPick(row.id);
      },
    }),
  );
  const standing = rows.find((row) => row.id === value);
  const mark = standing === undefined ? icon : <>{standing.icon}</>;
  return mark === undefined ? { label, items } : { label, icon: mark, items };
}

export function statusSubmenu(
  tasks: Pick<TasksControl, "onSettleTasks">,
  taskIds: readonly string[],
  current: TaskStatus | undefined,
  onActed?: () => void,
): MenuSubmenu {
  return chipSubmenu(
    STANDING_WORDS.STATUS,
    STATUS_ROWS,
    current,
    (id) => {
      const picked = TASK_STATUS_ORDER.find((status) => status === id);
      if (picked !== undefined) tasks.onSettleTasks(taskIds, picked);
      onActed?.();
    },
    <TaskStatusMark status={TASK_STATUS.TODO} />,
  );
}

export function keyedStatusSubmenu(
  tasks: Pick<TasksControl, "onSettleTasks">,
  taskId: string,
  current: TaskStatus,
  keyed: boolean,
): MenuSubmenu {
  const submenu = statusSubmenu(tasks, [taskId], current);
  return keyed ? { ...submenu, command: APP_COMMAND.SET_STATUS } : submenu;
}

export function sharedStatus(
  held: readonly { readonly status?: TaskStatus | undefined }[],
): TaskStatus | undefined {
  const statuses = new Set(held.map((task) => task.status ?? TASK_STATUS.TODO));
  return statuses.size === 1 ? [...statuses][0] : undefined;
}
