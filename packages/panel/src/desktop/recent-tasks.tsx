import type { TaskSummary } from "@repo/features/task-wire";
import {
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  TASK_ROW_CELL,
  TASK_ROW_EDGES,
  type TaskRowCell,
  TaskRowSkeleton,
  TaskRows,
  useMinute,
} from "@repo/ui";
import { assigneeFace } from "@repo/ui/actor-model";
import { repositoryLabel } from "@repo/ui/task-list-model";
import { type ListColumn, TASK_PROPERTY } from "@repo/ui/tasks-page-model";
import { type ReactNode, useState } from "react";
import { useCoarsePointer } from "../coarse-pointer.js";
import { useMemberDirectory } from "../member-directory.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useFittedColumns } from "./fitted-columns.js";
import { SectionSkeleton } from "./person-frame.js";
import { openedTaskOf, taskRowTab } from "./task-actions.js";
import { taskCardOf } from "./task-card.js";
import { TaskListRow } from "./task-list-row.js";
import { useStandingDoor } from "./task-row-parts.js";

const CELLS_WITH_FACE = [
  TASK_PROPERTY.STATUS,
  TASK_PROPERTY.REPOSITORY,
  TASK_PROPERTY.ASSIGNEE,
  TASK_PROPERTY.AGENTS,
  TASK_PROPERTY.UPDATED,
] as const satisfies readonly (TaskRowCell & ListColumn)[];

const CELLS_WITHOUT_FACE = CELLS_WITH_FACE.filter((cell) => cell !== TASK_PROPERTY.ASSIGNEE);

const SKELETON_NAMES = ["46%", "38%", "54%"] as const;

const SKELETON_REPOSITORY = "72px";

const SKELETON_MARK = "16px";

const SKELETON_TIME = "24px";

function cellsOf(face: boolean): readonly (TaskRowCell & ListColumn)[] {
  return face ? CELLS_WITH_FACE : CELLS_WITHOUT_FACE;
}

function GlanceRows({
  label,
  cells,
  joinsWalk,
  moves,
  children,
}: {
  label: string;
  cells: readonly (TaskRowCell & ListColumn)[];
  joinsWalk: boolean;
  moves: boolean;
  children: (cells: readonly TaskRowCell[], more: boolean) => ReactNode;
}): React.JSX.Element {
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const fitted = useFittedColumns(list, cells);
  const more = !useCoarsePointer();
  return (
    <div ref={setList} className="recent-tasks min-w-0">
      <TaskRows
        label={label}
        cells={fitted}
        more={more}
        edges={TASK_ROW_EDGES.UNCHOSEN}
        joinsWalk={joinsWalk}
        moves={moves}
      >
        {children(fitted, more)}
      </TaskRows>
    </div>
  );
}

export function RecentTasks({
  tasks,
  label,
  listed,
  unread,
  onOpen,
  face = true,
  joinsWalk = false,
  moves = false,
}: {
  tasks: TasksControl;
  label: string;
  listed: readonly TaskSummary[];
  unread: (task: TaskSummary) => boolean;
  onOpen: (taskId: string) => void;
  face?: boolean | undefined;
  joinsWalk?: boolean | undefined;
  moves?: boolean | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const directory = useMemberDirectory();
  const setStanding = useStandingDoor(tasks);
  const rowTab = taskRowTab(tasks);
  const opened = openedTaskOf(tasks);
  const workspaceName = tasks.workspace?.name ?? "";
  return (
    <GlanceRows label={label} cells={cellsOf(face)} joinsWalk={joinsWalk} moves={moves}>
      {(cells, more) =>
        listed.map((task) => (
          <TaskListRow
            key={task.id}
            tasks={rowTab}
            task={task}
            opened={opened}
            workspaceName={workspaceName}
            cells={cells}
            repositoryName={
              task.repository === null ? undefined : repositoryLabel(task.repository, listed)
            }
            assigneeHeld={face && assigneeFace(task, directory) === undefined}
            chosen={undefined}
            more={more}
            edges={TASK_ROW_EDGES.UNCHOSEN}
            unread={unread(task)}
            card={taskCardOf(tasks, task, now)}
            onOpen={() => onOpen(task.id)}
            onStanding={(standing) => setStanding(task, standing)}
          />
        ))
      }
    </GlanceRows>
  );
}

export function RecentTasksSkeleton({
  label,
  face = true,
}: {
  label: string;
  face?: boolean | undefined;
}): React.JSX.Element {
  const blocks: Partial<Record<TaskRowCell, ReactNode>> = {
    [TASK_ROW_CELL.STATUS]: <Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_MARK} />,
    [TASK_ROW_CELL.REPOSITORY]: <Skeleton width={SKELETON_REPOSITORY} />,
    [TASK_ROW_CELL.UPDATED]: <Skeleton width={SKELETON_TIME} />,
  };
  return (
    <SectionSkeleton>
      <SkeletonRegion label={label}>
        <GlanceRows label={label} cells={cellsOf(face)} joinsWalk={false} moves={false}>
          {(cells) =>
            SKELETON_NAMES.map((name) => (
              <TaskRowSkeleton
                key={name}
                cells={cells}
                name={name}
                content={blocks}
                edges={TASK_ROW_EDGES.UNCHOSEN}
              />
            ))
          }
        </GlanceRows>
      </SkeletonRegion>
    </SectionSkeleton>
  );
}
