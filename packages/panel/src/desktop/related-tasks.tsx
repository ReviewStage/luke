import type { TaskSummary } from "@luke/features/task-wire";
import {
  type ListRowFold,
  RELATED_TASK_CELLS,
  TASK_ROW_CELL,
  type TaskRowCell,
  TaskRows,
} from "@luke/ui";
import { childTaskCounts } from "@luke/ui/task-list-model";
import { LIST_COLUMN, type ListColumn, TASK_PROPERTY } from "@luke/ui/tasks-page-model";
import { type ReactNode, useMemo, useState } from "react";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import type { MenuEntry } from "./action-menu.js";
import { useFittedColumns } from "./fitted-columns.js";
import { openPullRequests, TaskListRow } from "./task-list-row.js";
import { useStandingDoor } from "./task-row-parts.js";
import { useTasksSelection } from "./tasks-selection.js";

/**
 * related-tasks.tsx -- a list of tasks standing on its own, outside the Tasks page: a task's child tasks or the tasks related to it, each drawn as the Tasks page's List draws it.
 *
 * Each row is the List's own (`task-list-row.tsx`) in a list of its own
 * (`TaskRows`), its columns fixed to the few a related task needs: its
 * priority, key, and status before its name, then its assignee, its open
 * pull requests, how many of its sub-tasks are finished, and what its owner
 * stands at its end, a relation's kind, say, before its ⋯, each of those
 * last three drawn only where a row fills it, and the List's columns
 * folding away by the list's own width as the List folds them
 * (`fitted-columns.ts`), key and sub-tasks first, before a name is squeezed. Its chips change the task where it stands, a press
 * opens it, and its ⋯, a right-click, and the menu key open its menu. Its
 * rows are one Tab stop that ↑↓ walk, and are chosen together as the List's
 * are, a row chosen among several offering the List's bar's acts on every
 * one chosen. A row may stand nested under another (`depth`), and fold the
 * rows nested under it (`fold`), whose owner keeps whether they stand open
 * and hands only the rows drawn. A row may stand settled, its name muted,
 * and lead its menu with groups of its owner's (`menu`).
 */

/** One row of the list: the task, what stands at its end, how deep it is nested, and the rows it folds. */
export interface RelatedTaskRow {
  readonly task: TaskSummary;
  /** What stands at the row's end, before its ⋯: the relation's kind, say. */
  readonly end?: ReactNode;
  readonly depth?: number;
  readonly fold?: ListRowFold;
  /** Whether it stands settled beside the rows still open, its name muted: a blocker that is done. */
  readonly settled?: boolean;
  /** Groups leading its menu, ahead of the task's own: its relation to change or take away. */
  readonly menu?: readonly (readonly MenuEntry[])[];
}

/** The room, in CSS pixels, each cell of a related task's that is none of the List's columns takes at its widest, the gap before it included. */
const OWN_CELL_ROOM = {
  [TASK_ROW_CELL.PULL_REQUESTS]: 72,
  [TASK_ROW_CELL.END]: 56,
} as const;

/** The List's columns, which fold away by a list's width as the List folds them. */
const LIST_COLUMNS: ReadonlySet<string> = new Set([
  ...Object.values(TASK_PROPERTY),
  ...Object.values(LIST_COLUMN),
]);

/** Whether a cell is one of the List's columns. */
function isListColumn(cell: TaskRowCell): cell is TaskRowCell & ListColumn {
  return LIST_COLUMNS.has(cell);
}

/** The room the cells drawn that are none of the List's columns take, which a list counts out of its width before it folds. */
function ownRoom(cells: readonly TaskRowCell[]): number {
  return cells.reduce(
    (room, cell) =>
      cell === TASK_ROW_CELL.PULL_REQUESTS || cell === TASK_ROW_CELL.END
        ? room + OWN_CELL_ROOM[cell]
        : room,
    0,
  );
}

/**
 * The cells the list draws: the related task's own, leaving out a column no
 * row fills, its pull requests, its sub-tasks' count, or its end, since an
 * empty column still costs the list a gap.
 */
function drawnCells(
  rows: readonly RelatedTaskRow[],
  subTasks: ReadonlyMap<string, unknown>,
): readonly TaskRowCell[] {
  const filled: Partial<Record<TaskRowCell, boolean>> = {
    [TASK_ROW_CELL.PULL_REQUESTS]: rows.some(({ task }) => openPullRequests(task).length > 0),
    [TASK_ROW_CELL.SUB_TASKS]: rows.some(({ task }) => subTasks.has(task.id)),
    [TASK_ROW_CELL.END]: rows.some(({ end }) => end !== undefined),
  };
  return RELATED_TASK_CELLS.filter((cell) => filled[cell] ?? true);
}

/** The list of `rows`, named by `label`. */
export function RelatedTasks({
  tasks,
  label,
  rows,
}: {
  tasks: TasksControl;
  label: string;
  /** The rows drawn, in order, those folded away left out. */
  rows: readonly RelatedTaskRow[];
}): React.JSX.Element {
  const setStanding = useStandingDoor(tasks);
  const selection = useTasksSelection(tasks, new Set(rows.map((row) => row.task.id)));
  const workspaceName = tasks.workspace?.name ?? "";
  const subTasks = useMemo(() => childTaskCounts(tasks.tasks), [tasks.tasks]);
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const filled = drawnCells(rows, subTasks);
  const fitted = useFittedColumns(list, filled.filter(isListColumn), {
    reserved: ownRoom(filled),
  });
  const cells = filled.filter((cell) => !isListColumn(cell) || fitted.includes(cell));
  return (
    // Note that the list is measured from a box of its own, the width its rows stand in, so its columns fold for the room it has.
    <div ref={setList} className="related-tasks min-w-0">
      <TaskRows
        id={selection.regionId}
        label={label}
        cells={cells}
        selection={{ selected: selection.selected, onChange: selection.onChange }}
      >
        {rows.map(({ task, end, depth, fold, settled, menu }) => (
          <TaskListRow
            key={task.id}
            tasks={tasks}
            task={task}
            workspaceName={workspaceName}
            cells={cells}
            subTasks={subTasks.get(task.id)}
            content={{ [TASK_ROW_CELL.END]: end }}
            chosen={selection.chosenOf(task.id)}
            onOpen={() => tasks.onSelect(task.id)}
            onStanding={(standing) => setStanding(task, standing)}
            depth={depth}
            fold={fold}
            settled={settled}
            menuGroups={menu}
          />
        ))}
      </TaskRows>
      {selection.dialog}
    </div>
  );
}
