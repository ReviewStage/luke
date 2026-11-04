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

/**
 * recent-tasks.tsx -- tasks listed for a glance, as Home's Recent and a person's page list them: each the Tasks page's own row, its status, its name, its repository, who is on it, how its agents stand, and when it last moved, hanging its card.
 *
 * Each row is the List's own (`task-list-row.tsx`) in a list of its own
 * (`TaskRows`), so a task reads the same on Home, a person's page, and the
 * Tasks page: its status's chip, which changes it where it stands, before
 * its name; then its repository led by its owner's picture, the face of who
 * is on it (`assigneeFace`): a teammate's chip where they are assigned, the
 * dashed unassigned mark where no one is, and none where the reader is; how
 * its agents stand; and its time, each in a column of its own that lines up
 * down the list, the columns folding away by the list's own width as the
 * List folds them (`fitted-columns.ts`) before a name is squeezed. A
 * person's own page says whose they are once in its head, so its rows wear
 * no face (`face`). Unread as the sidebar counts it, a row's name stands in
 * the heavier weight, and its menu offers to mark it read; its card hangs
 * beside it while the pointer rests on it (`taskCardOf`). Its rows are
 * never chosen, so they keep no gutter for a box, and a finger's row draws
 * no ⋯, its menu a long press away.
 */

/** The cells a glance at a task draws, in a row's order: who is on it among them. */
const CELLS_WITH_FACE = [
  TASK_PROPERTY.STATUS,
  TASK_PROPERTY.REPOSITORY,
  TASK_PROPERTY.ASSIGNEE,
  TASK_PROPERTY.AGENTS,
  TASK_PROPERTY.UPDATED,
] as const satisfies readonly (TaskRowCell & ListColumn)[];

/** The cells a person's page draws, whose head says once whose the tasks are. */
const CELLS_WITHOUT_FACE = CELLS_WITH_FACE.filter((cell) => cell !== TASK_PROPERTY.ASSIGNEE);

/** How wide each placeholder row's name stands, so the rows read as rows of their own. */
const SKELETON_NAMES = ["46%", "38%", "54%"] as const;

/** How wide a placeholder repository's name stands, as a short repository's does. */
const SKELETON_REPOSITORY = "72px";

/** A placeholder mark, at a row glyph's size. */
const SKELETON_MARK = "16px";

/** How wide a placeholder time stands, as a short one does: 3d. */
const SKELETON_TIME = "24px";

/** The cells drawn, with or without who is on each task. */
function cellsOf(face: boolean): readonly (TaskRowCell & ListColumn)[] {
  return face ? CELLS_WITH_FACE : CELLS_WITHOUT_FACE;
}

/**
 * A list of tasks at a glance, named by `label`, its columns those of
 * `cells` that fit its width, its rows drawn by `children` for the cells
 * that stand.
 */
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
  // Note that the list is measured from a box of its own, the width its rows stand in, so its columns fold for the room it has.
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

/** Tasks at a glance, newest first as their owner lists them, each opening its task. */
export function RecentTasks({
  tasks,
  label,
  listed,
  unread,
  face = true,
  joinsWalk = false,
  moves = false,
}: {
  tasks: TasksControl;
  /** What the list is called. */
  label: string;
  /** The tasks drawn, in order, a row leaving drawn on until its exit has played where its owner keeps it. */
  listed: readonly TaskSummary[];
  /** Whether a task is unread as the sidebar's row counts it (`useUnreadTasks`). */
  unread: (task: TaskSummary) => boolean;
  /** Whether the rows wear who is on each task, which a person's own page says once in its head instead. */
  face?: boolean | undefined;
  /** Whether its rows join the walk of the rows of the lists beside it (`TaskRows`'s `joinsWalk`). */
  joinsWalk?: boolean | undefined;
  /** Whether its rows move as they arrive, leave, and change places, under a `ListMotion`. */
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
            // Note that a task the reader is on wears no face, since the rows are theirs to glance at.
            assigneeHeld={face && assigneeFace(task, directory) === undefined}
            chosen={undefined}
            more={more}
            edges={TASK_ROW_EDGES.UNCHOSEN}
            unread={unread(task)}
            card={taskCardOf(tasks, task, now)}
            onOpen={() => tasks.onSelect(task.id)}
            onStanding={(standing) => setStanding(task, standing)}
          />
        ))
      }
    </GlanceRows>
  );
}

/**
 * A list of tasks at a glance still being read, which `label` names: its
 * own rows, a block where each name will stand and in each cell but the
 * face, which stands for someone not yet known.
 */
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
