import type { TaskSummary } from "@repo/features/task-wire";
import { taskKey } from "@repo/features/workspace-key";
import {
  type ListRowFold,
  RELATED_TASK_CELLS,
  TASK_ROW_CELL,
  type TaskRowCell,
  taskRowFit,
  VirtualTaskRows,
} from "@repo/ui";
import { childTaskCounts } from "@repo/ui/task-list-model";
import { LIST_COLUMN, type ListColumn, TASK_PROPERTY } from "@repo/ui/tasks-page-model";
import { type ReactNode, useMemo, useState } from "react";
import { useCoarsePointer } from "../coarse-pointer.js";
import { useFindOpen } from "../find-in-tab.js";
import { pullRequestNumberLabel } from "../tasks/agent-model.js";
import type { DescriptionRoom } from "../tasks/description-body.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import type { MenuEntry } from "./action-menu.js";
import { useFittedColumns } from "./fitted-columns.js";
import { nestsOf } from "./nested-rows.js";
import { openedTaskOf, taskRowTab } from "./task-actions.js";
import { openPullRequests, TaskListRow } from "./task-list-row.js";
import { useStandingDoor } from "./task-row-parts.js";
import { useTasksSelection } from "./tasks-selection.js";

export interface RelatedTaskRow {
  readonly task: TaskSummary;
  readonly relation?: ReactNode;
  readonly relationWords?: string;
  readonly depth?: number;
  readonly fold?: ListRowFold;
  readonly settled?: boolean;
  readonly menu?: readonly (readonly MenuEntry[])[];
  readonly unlisted?: boolean;
}

const OWN_CELL_ROOM: Partial<Record<TaskRowCell, number>> = {
  [TASK_ROW_CELL.RELATION]: 120,
  [TASK_ROW_CELL.PULL_REQUESTS]: 72,
  [TASK_ROW_CELL.SUB_TASKS]: 76,
};

const LIST_COLUMNS: ReadonlySet<string> = new Set(
  [...Object.values(TASK_PROPERTY), ...Object.values(LIST_COLUMN)].filter(
    (column) => column !== LIST_COLUMN.SUB_TASKS,
  ),
);

function isListColumn(cell: TaskRowCell): cell is TaskRowCell & ListColumn {
  return LIST_COLUMNS.has(cell);
}

function ownRoom(cells: readonly TaskRowCell[]): number {
  return cells.reduce((room, cell) => room + (OWN_CELL_ROOM[cell] ?? 0), 0);
}

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

export function RelatedTasks({
  tasks,
  label,
  rows,
  room,
  onOpenTask,
}: {
  tasks: TasksControl;
  label: string;
  rows: readonly RelatedTaskRow[];
  room: DescriptionRoom;
  onOpenTask: (taskId: string) => void;
}): React.JSX.Element {
  const setStanding = useStandingDoor(tasks);
  const selection = useTasksSelection(tasks, new Set(rows.map((row) => row.task.id)));
  const workspaceName = tasks.workspace?.name ?? "";
  const rowTab = taskRowTab(tasks);
  const opened = openedTaskOf(tasks);
  const subTasks = useMemo(() => childTaskCounts(tasks.tasks), [tasks.tasks]);
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const filled = drawnCells(rows, subTasks);
  const fitted = useFittedColumns(list, filled.filter(isListColumn), {
    reserved: ownRoom(filled),
  });
  const cells = filled.filter((cell) => !isListColumn(cell) || fitted.includes(cell));
  const more = !useCoarsePointer();
  const nests = nestsOf(rows.map(({ depth = 0 }) => ({ depth })));
  const keys = useMemo(() => rows.map(({ task }) => task.id), [rows]);
  const fit = useMemo(
    () =>
      taskRowFit(
        rows.map(({ task, relationWords }) => {
          const counted = subTasks.get(task.id);
          return {
            key: task.number === undefined ? undefined : taskKey(workspaceName, task.number),
            relation: relationWords,
            pullRequests: openPullRequests(task).map(pullRequestNumberLabel),
            subTasks:
              counted === undefined || counted.total === 0
                ? undefined
                : `${counted.finished}/${counted.total}`,
          };
        }),
      ),
    [rows, subTasks, workspaceName],
  );
  const finding = useFindOpen();
  return (
    <div ref={setList} className="related-tasks min-w-0">
      <VirtualTaskRows
        id={selection.regionId}
        label={label}
        cells={cells}
        more={more}
        selection={{ selected: selection.selected, onChange: selection.onChange }}
        scroller={room.scroller}
        shiftedBy={room.column}
        keys={keys}
        overscan={finding ? keys.length : undefined}
        fit={fit}
      >
        {(index, place) => {
          const row = rows[index];
          if (row === undefined) return null;
          const { task, relation, depth, fold, settled, menu, unlisted } = row;
          return (
            <TaskListRow
              key={task.id}
              place={place}
              tasks={rowTab}
              task={task}
              opened={opened}
              workspaceName={workspaceName}
              cells={cells}
              subTasks={subTasks.get(task.id)}
              content={{ [TASK_ROW_CELL.RELATION]: relation }}
              chosen={selection.chosenOf(task.id)}
              onOpen={() => onOpenTask(task.id)}
              onStanding={(standing) => setStanding(task, standing)}
              depth={depth}
              nest={nests[index]}
              fold={fold}
              settled={settled}
              menuGroups={menu}
              unlisted={unlisted}
              more={more}
            />
          );
        }}
      </VirtualTaskRows>
      {selection.dialog}
    </div>
  );
}
