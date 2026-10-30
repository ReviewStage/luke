import type { TaskSummary } from "@luke/features/task-wire";
import { type ListRowFold, RELATED_TASK_CELLS, TASK_ROW_CELL, TaskRows } from "@luke/ui";
import { childTaskCounts } from "@luke/ui/task-list-model";
import { type ReactNode, useMemo } from "react";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { TaskListRow } from "./task-list-row.js";
import { useStandingDoor } from "./task-row-parts.js";
import { useTasksSelection } from "./tasks-selection.js";

/**
 * related-tasks.tsx -- a list of tasks standing on its own, outside the Tasks page: a task's child tasks or the tasks related to it, each drawn as the Tasks page's List draws it.
 *
 * Each row is the List's own (`task-list-row.tsx`) in a list of its own
 * (`TaskRows`), its columns fixed to the few a related task needs: its
 * priority, key, and status before its name, then its assignee, its open
 * pull requests, how many of its sub-tasks are finished, and what its owner
 * stands at its end, a relation's kind, say, before its ⋯. Its chips change the task where it stands, a press
 * opens it, and its ⋯, a right-click, and the menu key open its menu. Its
 * rows are one Tab stop that ↑↓ walk, and are chosen together as the List's
 * are, a row chosen among several offering the List's bar's acts on every
 * one chosen. A row may stand nested under another (`depth`), and fold the
 * rows nested under it (`fold`), whose owner keeps whether they stand open
 * and hands only the rows drawn.
 */

/** One row of the list: the task, what stands at its end, how deep it is nested, and the rows it folds. */
export interface RelatedTaskRow {
  readonly task: TaskSummary;
  /** What stands at the row's end, before its ⋯: the relation's kind, say. */
  readonly end?: ReactNode;
  readonly depth?: number;
  readonly fold?: ListRowFold;
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
  return (
    <>
      <TaskRows
        id={selection.regionId}
        label={label}
        cells={RELATED_TASK_CELLS}
        selection={{ selected: selection.selected, onChange: selection.onChange }}
      >
        {rows.map(({ task, end, depth, fold }) => (
          <TaskListRow
            key={task.id}
            tasks={tasks}
            task={task}
            workspaceName={workspaceName}
            cells={RELATED_TASK_CELLS}
            subTasks={subTasks.get(task.id)}
            content={{ [TASK_ROW_CELL.END]: end }}
            chosen={selection.chosenOf(task.id)}
            onOpen={() => tasks.onSelect(task.id)}
            onStanding={(standing) => setStanding(task, standing)}
            depth={depth}
            fold={fold}
          />
        ))}
      </TaskRows>
      {selection.dialog}
    </>
  );
}
