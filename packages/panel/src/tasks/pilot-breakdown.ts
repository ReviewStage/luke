/**
 * pilot-breakdown.ts -- a pilot task's breakdown as it waits for its tree to run: the child tasks still waiting.
 *
 * A pilot writes its breakdown as child tasks that wait in todo, each with
 * no agent, and starts their coding agents once its tree's Running switch is
 * on. Every such child stands in the breakdown that waits; a child started,
 * settled, or put back in the backlog does not. Nothing waits on a task
 * worked by its agents, whatever its children.
 */

import { TASK_MODE, TASK_STATUS, type TaskSummary } from "@luke/features/task-wire";

/**
 * The child tasks of `task` waiting to start, in the order the pilot made
 * them: todo, with no agent. None for a task not worked by a pilot.
 */
export function waitingChildTasks(
  task: Pick<TaskSummary, "id" | "mode">,
  tasks: readonly TaskSummary[],
): readonly TaskSummary[] {
  if (task.mode !== TASK_MODE.PILOT) return [];
  return tasks
    .filter(
      (each) =>
        each.parentTaskId === task.id &&
        each.status === TASK_STATUS.TODO &&
        (each.agents?.total ?? 0) === 0,
    )
    .toSorted(
      (a, b) =>
        (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt - b.createdAt,
    );
}
