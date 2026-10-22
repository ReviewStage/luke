import { taskHasMergedPullRequest } from "@luke/database/models/coding-agent-store";
import type { TaskStoreEffect } from "@luke/database/models/task-store";
import { TASK_STATUS, type TaskStatus } from "@luke/features/task-wire";
import { Effect } from "effect";

/**
 * archive-settle.ts -- what an archive or an unarchive asked of a task does, now that a task is archived no longer.
 *
 * A task stands in a status alone: Backlog, Todo, In progress, Done, or
 * Canceled. An older desktop build, or a coding agent's call from before
 * the change, still asks to archive a task or to bring one back, and the
 * request's shape is kept so neither breaks; nothing writes the task's
 * archive stamp again. An archive settles the task instead: Done where any
 * coding agent on it, archived ones among them, has a pull request GitHub
 * reported merged, and Canceled where none does, as the migration that
 * settled the archived tasks read them; a task already Done or Canceled
 * keeps its status. An unarchive puts the task back to work, In progress.
 */

/** The statuses a task is finished in, which an archive leaves as they stand. */
const SETTLED_STATUSES: ReadonlySet<TaskStatus> = new Set([TASK_STATUS.DONE, TASK_STATUS.CANCELED]);

/**
 * The status an archive asked by an older build settles the task into: the
 * one it stands in where that is Done or Canceled, else Done where an agent
 * on it has a merged pull request and Canceled where none does.
 */
function archiveSettledStatus(
  userId: string,
  taskId: string,
  standing: TaskStatus,
): TaskStoreEffect<TaskStatus> {
  if (SETTLED_STATUSES.has(standing)) return Effect.succeed(standing);
  return Effect.map(taskHasMergedPullRequest(userId, taskId), (merged) =>
    merged ? TASK_STATUS.DONE : TASK_STATUS.CANCELED,
  );
}

/** The status an archive or an unarchive asked by an older build moves the task to: settled, or back to work. */
export function archiveAskedStatus(
  userId: string,
  taskId: string,
  standing: TaskStatus,
  archived: boolean,
): TaskStoreEffect<TaskStatus> {
  return archived
    ? archiveSettledStatus(userId, taskId, standing)
    : Effect.succeed(TASK_STATUS.IN_PROGRESS);
}
