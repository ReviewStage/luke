import type { DatabaseServices } from "@repo/database/core/query";
import {
  readTaskHeader,
  TaskParentRepositoryDiffers,
  TaskParentUnreached,
  type TaskStoreFailure,
} from "@repo/database/models/task-store";
import { isWorkspaceMember } from "@repo/database/models/workspace-store";
import { Effect, Option } from "effect";

export interface TaskParent {
  readonly id: string;
  readonly repository: string | null;
  readonly assigneeId: string | null;
}

function sameRepository(asked: string | null, held: string | null): boolean {
  if (asked === null || held === null) return asked === held;
  return asked.toLowerCase() === held.toLowerCase();
}

export const taskParentOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  parentTaskId: string,
  repositoryAsked: string | null | undefined,
): Effect.fn.Return<
  TaskParent,
  TaskParentUnreached | TaskParentRepositoryDiffers | TaskStoreFailure,
  DatabaseServices
> {
  const header = yield* readTaskHeader(userId, parentTaskId);
  if (Option.isNone(header) || header.value.workspaceId !== workspaceId) {
    return yield* new TaskParentUnreached();
  }
  const { repository } = header.value;
  if (repositoryAsked !== undefined && !sameRepository(repositoryAsked, repository)) {
    return yield* new TaskParentRepositoryDiffers({ repository });
  }
  const { assigneeId } = header.value;
  const assignable =
    assigneeId !== null && (yield* isWorkspaceMember(assigneeId, workspaceId)) ? assigneeId : null;
  return { id: parentTaskId, repository, assigneeId: assignable };
});
