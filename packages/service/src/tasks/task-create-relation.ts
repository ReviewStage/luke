/**
 * task-create-relation.ts -- the relation a start makes its task in, confirmed before the start writes and written beside it in the start's own transaction.
 *
 * A task may start related to another (`taskCreateRequestSchema`'s
 * `relation`, from the new task's side): a sub-task of it, which the start
 * makes as it makes a child of `parentTaskId` (`task-parent.ts`); its
 * parent; or a block on either side. The other task is read as its maker
 * reaches it before anything is written (`relationAsked`), so one out of
 * reach, of another workspace, or named by nothing all read alike as
 * unreached, and a start as a task's parent takes that task's repository,
 * as a child takes its parent's, refusing a start that names another. Then,
 * once the task's row stands, the relation is written under the same
 * transaction (`relationWritten`), through the doors a relation added later
 * goes through (`setTaskParent`, `addTaskBlock`), so their rules hold and
 * the task and its relation land together or not at all. A start as a
 * parent is refused where the other task has a parent already, checked
 * under that task's lock, since a start never takes a parent's place.
 */

import type { DatabaseServices, StoreFailure } from "@luke/database/core/query";
import {
  addTaskBlock,
  lockTasksForBlocks,
  type TaskBlockAcrossWorkspaces,
  type TaskBlockCycle,
  type TaskBlockPair,
  type TaskBlockSelf,
} from "@luke/database/models/task-block-store";
import {
  createTaskCommitted,
  type NewTask,
  readTaskHeader,
  type StoredTask,
  setTaskParent,
  type TaskAssigneeNotMember,
  type TaskCommitted,
  type TaskParentCycle,
  TaskParentRepositoryDiffers,
  type TaskParentUnreached,
} from "@luke/database/models/task-store";
import {
  TASK_CREATE_RELATION_KIND,
  type TaskBlockRelation,
  type TaskCreateRelation,
} from "@luke/features/task-wire";
import { Data, Effect, Option } from "effect";
import { SqlClient } from "effect/sql";

/** The other task a start's relation names is none the maker reaches in the workspace the task starts in; nothing was written. */
class TaskRelationUnreached extends Data.TaggedError("TaskRelationUnreached") {}

/** The task a start would be the parent of has a parent already, which a start never takes the place of; nothing was written. */
class TaskParentHeld extends Data.TaggedError("TaskParentHeld") {}

/** Why a start's relation was not written, nothing written: the other task out of reach, the parent's refusals, or the block's. */
export type TaskCreateRelationRefused =
  | TaskRelationUnreached
  | TaskParentHeld
  | TaskParentUnreached
  | TaskParentRepositoryDiffers
  | TaskParentCycle
  | TaskBlockSelf
  | TaskBlockAcrossWorkspaces
  | TaskBlockCycle;

/** The relation a start asked other than a sub-task's, which the start makes as a child of its parent instead, confirmed: the other task, how the new task stands to it, and, as the other's parent, the repository the new task takes. */
export type TaskCreateRelationAsked =
  | {
      readonly kind: typeof TASK_CREATE_RELATION_KIND.PARENT_OF;
      readonly taskId: string;
      /** The other task's repository, which the new task takes as its parent. */
      readonly repository: string | null;
    }
  | { readonly kind: TaskBlockRelation; readonly taskId: string };

/** Whether a repository a start names is the other task's: GitHub's names match whatever their case, and none matches none. */
function sameRepository(asked: string | null, held: string | null): boolean {
  if (asked === null || held === null) return asked === held;
  return asked.toLowerCase() === held.toLowerCase();
}

/** The block a kind names between the new task and the other, where the kind is a block's side. */
function blockPairOf(taskId: string, otherId: string, kind: TaskBlockRelation): TaskBlockPair {
  return kind === TASK_CREATE_RELATION_KIND.BLOCKED_BY
    ? { blockerTaskId: otherId, blockedTaskId: taskId }
    : { blockerTaskId: taskId, blockedTaskId: otherId };
}

/**
 * The relation a start asked other than a sub-task's, confirmed as `userId`
 * reaches the other task in `workspaceId`, before anything is written;
 * `repositoryAsked` is the one the start named, left out where it named
 * none, which a start as the other's parent must match. A start as a
 * sub-task is the parent's own check (`taskParentOf`), so it answers
 * nothing here.
 */
export const relationAsked = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  relation: TaskCreateRelation,
  repositoryAsked: string | null | undefined,
): Effect.fn.Return<
  TaskCreateRelationAsked | undefined,
  TaskRelationUnreached | TaskParentRepositoryDiffers | StoreFailure,
  DatabaseServices
> {
  const { kind, taskId } = relation;
  if (kind === TASK_CREATE_RELATION_KIND.SUB_TASK_OF) return undefined;
  const header = yield* readTaskHeader(userId, taskId);
  if (Option.isNone(header) || header.value.workspaceId !== workspaceId) {
    return yield* new TaskRelationUnreached();
  }
  if (kind !== TASK_CREATE_RELATION_KIND.PARENT_OF) return { kind, taskId };
  const { repository } = header.value;
  if (repositoryAsked !== undefined && !sameRepository(repositoryAsked, repository)) {
    return yield* new TaskParentRepositoryDiffers({ repository });
  }
  return { kind, taskId, repository };
});

/** The other task made the new task's child, under its lock; refused where it has a parent already, and nothing where it is out of reach by now. */
const parentTaken = (
  userId: string,
  taskId: string,
  otherId: string,
): Effect.Effect<
  Option.Option<void>,
  | StoreFailure
  | TaskParentHeld
  | TaskParentUnreached
  | TaskParentRepositoryDiffers
  | TaskParentCycle,
  DatabaseServices
> =>
  Effect.gen(function* () {
    // Note that the other task is held for update before its parent is read, because two starts as its
    // parent at once would each read none and the later write would take the earlier's place.
    const reached = yield* lockTasksForBlocks(userId, [otherId]);
    if (reached !== 1) return Option.none();
    const header = yield* readTaskHeader(userId, otherId);
    if (Option.isNone(header)) return Option.none();
    if (header.value.parentTaskId !== null) return yield* new TaskParentHeld();
    return Option.map(yield* setTaskParent(userId, otherId, taskId), () => undefined);
  });

/** The relation written for the task just started: the other task made its child, or a block on the side the kind names. Nothing where the other task is out of reach by now. */
function relationWritten(
  userId: string,
  taskId: string,
  asked: TaskCreateRelationAsked,
): Effect.Effect<Option.Option<void>, StoreFailure | TaskCreateRelationRefused, DatabaseServices> {
  switch (asked.kind) {
    case TASK_CREATE_RELATION_KIND.PARENT_OF:
      return parentTaken(userId, taskId, asked.taskId);
    case TASK_CREATE_RELATION_KIND.BLOCKED_BY:
    case TASK_CREATE_RELATION_KIND.BLOCKS:
      return Effect.map(
        addTaskBlock(userId, blockPairOf(taskId, asked.taskId, asked.kind)),
        Option.map(() => undefined),
      );
  }
}

/**
 * Starts the task as `createTaskCommitted` starts one and writes the
 * relation asked beside it in one transaction, through the doors a relation
 * added later goes through (`setTaskParent`, `addTaskBlock`), so their rules
 * hold and the task and its relation land together or not at all; the task
 * alone where none is asked. Note that the row's transaction id is the
 * outer transaction's, which a nested write only marks a savepoint in, so
 * the answer's `txid` still names the one commit a follower waits for.
 */
export function createTaskRelated(
  userId: string,
  started: NewTask,
  asked: TaskCreateRelationAsked | undefined,
): Effect.Effect<
  TaskCommitted<StoredTask>,
  StoreFailure | TaskAssigneeNotMember | TaskCreateRelationRefused,
  DatabaseServices
> {
  if (asked === undefined) return createTaskCommitted(userId, started);
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const created = yield* createTaskCommitted(userId, started);
        const related = yield* relationWritten(userId, created.task.task.id, asked);
        if (Option.isNone(related)) return yield* new TaskRelationUnreached();
        return created;
      }),
    ),
  );
}
