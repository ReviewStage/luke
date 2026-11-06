import { taskHasMergedPullRequest } from "@repo/database/models/agent-store";
import type { TaskStoreEffect } from "@repo/database/models/task-store";
import { TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import { Effect } from "effect";

const SETTLED_STATUSES: ReadonlySet<TaskStatus> = new Set([TASK_STATUS.DONE, TASK_STATUS.CANCELED]);

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
