/**
 * task-parent.ts -- the parent a new task is made under, confirmed: reached by its maker in the same workspace, and the repository and machine its child takes.
 *
 * A task may be made as the child of another, to any depth, by a member's
 * create (`tasks-procedures.ts`) and by an agent's `create_task`
 * (`agents/task-tools.ts`), both through this one check. The parent is read
 * as its maker reaches it (`readTaskHeader`), so a task another account
 * cannot open, one of a workspace it is not in, and one that names nothing
 * all read alike as unreached, and one of another workspace than the child's
 * is unreached too. A child works where its parent works: it takes the
 * parent's repository and machine, and a create that names another
 * repository is refused rather than overruled, so nothing is made somewhere
 * its maker did not ask; the refusals are the store's own, which a parent
 * set after creation (`setTaskParent`) answers too. It also hands back the parent's assignee, which a
 * create that names none gives its child, or none where that member has left
 * the workspace. Nesting has no bound.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  readTaskHeader,
  TaskParentRepositoryDiffers,
  TaskParentUnreached,
  type TaskRunsOnWrite,
  type TaskStoreFailure,
} from "@luke/database/models/task-store";
import { isWorkspaceMember } from "@luke/database/models/workspace-store";
import { Effect, Option } from "effect";

/** The parent a child is made under, and what the child takes from it. */
export interface TaskParent {
  readonly id: string;
  readonly repository: string | null;
  readonly runsOn: TaskRunsOnWrite;
  /** The parent's assignee while still a member of the workspace; null for none. */
  readonly assigneeId: string | null;
}

/** Whether a repository a create names is the parent's: GitHub's names match whatever their case, and none matches none. */
function sameRepository(asked: string | null, held: string | null): boolean {
  if (asked === null || held === null) return asked === held;
  return asked.toLowerCase() === held.toLowerCase();
}

/**
 * The parent a child is made under in `workspaceId`, as `userId` reaches it,
 * with the repository and machine the child takes; `repositoryAsked` is the
 * one the create named, left out where it named none.
 */
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
  const { repository, runsOn } = header.value;
  if (repositoryAsked !== undefined && !sameRepository(repositoryAsked, repository)) {
    return yield* new TaskParentRepositoryDiffers({ repository });
  }
  // Note that a member who has left is dropped rather than refused, since the store would refuse the child for them.
  const { assigneeId } = header.value;
  const assignable =
    assigneeId !== null && (yield* isWorkspaceMember(assigneeId, workspaceId)) ? assigneeId : null;
  return { id: parentTaskId, repository, runsOn, assigneeId: assignable };
});
