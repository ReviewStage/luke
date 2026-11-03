import type { TaskSummary } from "@repo/features/task-wire";
import {
  type ListRowFold,
  RELATED_TASK_CELLS,
  TASK_ROW_CELL,
  type TaskRowCell,
  TaskRows,
} from "@repo/ui";
import { childTaskCounts } from "@repo/ui/task-list-model";
import { LIST_COLUMN, type ListColumn, TASK_PROPERTY } from "@repo/ui/tasks-page-model";
import { type ReactNode, useMemo, useState } from "react";
import { useCoarsePointer } from "../coarse-pointer.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import type { MenuEntry } from "./action-menu.js";
import { useFittedColumns } from "./fitted-columns.js";
import { nestsOf } from "./nested-rows.js";
import { openPullRequests, TaskListRow } from "./task-list-row.js";
import { useStandingDoor } from "./task-row-parts.js";
import { useTasksSelection } from "./tasks-selection.js";

/**
 * related-tasks.tsx -- a list of tasks standing on its own, outside the Tasks page: a task's child tasks or the tasks related to it, each drawn as the Tasks page's List draws it.
 *
 * Each row is the List's own (`task-list-row.tsx`) in a list of its own
 * (`TaskRows`), its columns fixed to the few a related task needs: what
 * its owner leads it with, its relation's kind in words, so the row reads
 * as a sentence, then its priority, key, and status before its name, then
 * its assignee, its open pull requests, and how many of its sub-tasks are
 * finished, before its ⋯, the relation and those last two drawn only where
 * a row fills them, and the List's columns folding away by the list's own
 * width as the List folds them (`fitted-columns.ts`), key first, before a
 * name is squeezed, but the sub-tasks' badge, which a sub-task with
 * sub-tasks of its own always wears, as the pull requests and the relation
 * always stand. Its chips change the task where it stands, a press
 * opens it, and its ⋯, a right-click, a long press, and the menu key open
 * its menu, a finger's row drawing no ⋯ and its list keeping it no column,
 * as the List's. Its
 * rows are one Tab stop that ↑↓ walk, and are chosen together as the List's
 * are, a row chosen among several offering the List's bar's acts on every
 * one chosen. A row may stand nested under another (`depth`), read at its
 * level and its place among its siblings (`nestsOf`), and fold the
 * rows nested under it (`fold`), whose owner keeps whether they stand open
 * and hands only the rows drawn. A row may stand settled, its name muted,
 * and lead its menu with groups of its owner's (`menu`).
 */

/** One row of the list: the task, what leads it, how deep it is nested, and the rows it folds. */
export interface RelatedTaskRow {
  readonly task: TaskSummary;
  /** What leads the row, before its priority: the relation's kind in words, say. */
  readonly relation?: ReactNode;
  readonly depth?: number;
  readonly fold?: ListRowFold;
  /** Whether it stands settled beside the rows still open, its name muted: a blocker that is done. */
  readonly settled?: boolean;
  /** Groups leading its menu, ahead of the task's own: its relation to change or take away. */
  readonly menu?: readonly (readonly MenuEntry[])[];
  /** Whether the window does not list the task yet, so the row draws its name, its end, and its menu's groups alone. */
  readonly unlisted?: boolean;
}

/** The room, in CSS pixels, each cell of a related task's that never folds away takes at its widest, the gap beside it included: the sub-tasks' badge's as the List counts it, and the relation's pill at its longest words, Blocked by. */
const OWN_CELL_ROOM: Partial<Record<TaskRowCell, number>> = {
  [TASK_ROW_CELL.RELATION]: 120,
  [TASK_ROW_CELL.PULL_REQUESTS]: 72,
  [TASK_ROW_CELL.SUB_TASKS]: 76,
};

/** The List's columns that fold away by a list's width as the List folds them; the sub-tasks' count stands whatever the width. */
const LIST_COLUMNS: ReadonlySet<string> = new Set(
  [...Object.values(TASK_PROPERTY), ...Object.values(LIST_COLUMN)].filter(
    (column) => column !== LIST_COLUMN.SUB_TASKS,
  ),
);

/** Whether a cell is one of the List's columns. */
function isListColumn(cell: TaskRowCell): cell is TaskRowCell & ListColumn {
  return LIST_COLUMNS.has(cell);
}

/** The room the cells drawn that never fold away take, which a list counts out of its width before it folds. */
function ownRoom(cells: readonly TaskRowCell[]): number {
  return cells.reduce((room, cell) => room + (OWN_CELL_ROOM[cell] ?? 0), 0);
}

/**
 * The cells the list draws: the related task's own, leaving out a column no
 * row fills, its relation, its pull requests, or its sub-tasks' count, since
 * an empty column still costs the list a gap.
 */
function drawnCells(
  rows: readonly RelatedTaskRow[],
  subTasks: ReadonlyMap<string, unknown>,
): readonly TaskRowCell[] {
  const filled: Partial<Record<TaskRowCell, boolean>> = {
    [TASK_ROW_CELL.RELATION]: rows.some(({ relation }) => relation !== undefined),
    [TASK_ROW_CELL.PULL_REQUESTS]: rows.some(({ task }) => openPullRequests(task).length > 0),
    [TASK_ROW_CELL.SUB_TASKS]: rows.some(({ task }) => subTasks.has(task.id)),
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
  const more = !useCoarsePointer();
  const nests = nestsOf(rows.map(({ depth = 0 }) => ({ depth })));
  return (
    // Note that the list is measured from a box of its own, the width its rows stand in, so its columns fold for the room it has.
    <div ref={setList} className="related-tasks min-w-0">
      <TaskRows
        id={selection.regionId}
        label={label}
        cells={cells}
        more={more}
        selection={{ selected: selection.selected, onChange: selection.onChange }}
      >
        {rows.map(({ task, relation, depth, fold, settled, menu, unlisted }, at) => (
          <TaskListRow
            key={task.id}
            tasks={tasks}
            task={task}
            workspaceName={workspaceName}
            cells={cells}
            subTasks={subTasks.get(task.id)}
            content={{ [TASK_ROW_CELL.RELATION]: relation }}
            chosen={selection.chosenOf(task.id)}
            onOpen={() => tasks.onSelect(task.id)}
            onStanding={(standing) => setStanding(task, standing)}
            depth={depth}
            nest={nests[at]}
            fold={fold}
            settled={settled}
            menuGroups={menu}
            unlisted={unlisted}
            more={more}
          />
        ))}
      </TaskRows>
      {selection.dialog}
    </div>
  );
}
