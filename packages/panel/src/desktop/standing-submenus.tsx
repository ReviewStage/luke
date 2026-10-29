import { TASK_STATUS, TASK_STATUS_ORDER, type TaskStatus } from "@luke/features/task-wire";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { type MenuRow, TaskStatusMark } from "@luke/ui";
import { STATUS_ROWS } from "../tasks/task-standing.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import type { MenuAction, MenuSubmenu } from "./action-menu.js";

/**
 * standing-submenus.tsx -- Status, Priority, and Assignee as a row menu's submenus, listing what the plan's chips list.
 *
 * A row draws no chips, so its menu stands for them, as Linear's right-click
 * does: each submenu lists the chip's own rows (`task-standing.tsx`), in its
 * order and with its marks, the value standing checked, and a pick of
 * another sets it as the chip's pick does. Status is set through the window's
 * one way of setting tasks at a status (`onSettleTasks`), whose toast offers
 * Undo, so the same submenu acts on one task's row, a group's header, and a
 * selection of several tasks alike.
 */

/** What a submenu says before its values. */
export const STANDING_WORDS = {
  STATUS: "Status",
  PRIORITY: "Priority",
  ASSIGNEE: "Assignee",
} as const;

/**
 * A chip's rows as a submenu headed `label`: each row's words, mark, and
 * card, the one `value` names checked, and a pick of any other handed to
 * `onPick` by its id. Its mark is the value's own, so the closed item says
 * where the task stands, and a generic one where nothing is checked.
 */
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

/**
 * Status for `taskIds`, each of the five by its mark, the one they all stand
 * at checked, `current`; none checked where they stand apart. A pick sets
 * every one at it, said in one toast whose Undo puts each back.
 */
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

/** Status for one task's row, printing S where the key opens it there (`useFocusedRowKeys`). */
export function keyedStatusSubmenu(
  tasks: Pick<TasksControl, "onSettleTasks">,
  taskId: string,
  current: TaskStatus,
  keyed: boolean,
): MenuSubmenu {
  const submenu = statusSubmenu(tasks, [taskId], current);
  return keyed ? { ...submenu, command: APP_COMMAND.SET_STATUS } : submenu;
}

/** The status every task given stands at, Todo for one from a service before statuses; none where they stand apart or none is given. */
export function sharedStatus(
  held: readonly { readonly status?: TaskStatus | undefined }[],
): TaskStatus | undefined {
  const statuses = new Set(held.map((task) => task.status ?? TASK_STATUS.TODO));
  return statuses.size === 1 ? [...statuses][0] : undefined;
}
