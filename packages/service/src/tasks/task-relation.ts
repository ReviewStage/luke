/**
 * task-relation.ts -- one relation of a task moved to another kind, in one transaction: a block's side, its sub-task, or its parent.
 *
 * A task stands to another in one of four ways (`TASK_RELATION_KIND`): the
 * other blocks it, it blocks the other, the other is its sub-task (a child
 * of it), or the other is its parent. `POST /api/plans/{id}/relation`
 * (`tasks-procedures.ts`) moves one such relation from the kind it stood in
 * to another, as the task head's menu changes a row's kind in place: the
 * old relation is taken away and the new one added inside one transaction,
 * under both tasks' locks, so either both land or neither does, and a block
 * added keeps the block store's rules (`task-block-store.ts`) as a parent
 * set keeps the task store's (`setTaskParent`). A relation that did not
 * stand in the kind it leaves is left alone, as a block taken away that did
 * not stand is, and the new one is added still.
 */

import type { DatabaseServices, StoreFailure } from "@luke/database/core/query";
import {
  addTaskBlock,
  lockTasksForBlocks,
  removeTaskBlock,
  type TaskBlockAcrossWorkspaces,
  type TaskBlockCycle,
  type TaskBlockPair,
  TaskBlockSelf,
  type TaskBlockWritten,
} from "@luke/database/models/task-block-store";
import {
  readTaskHeader,
  setTaskParent,
  type TaskParentCycle,
  type TaskParentRepositoryDiffers,
  type TaskParentUnreached,
} from "@luke/database/models/task-store";
import {
  TASK_RELATION_KIND,
  type TaskRelationChangeRequest,
  type TaskRelationKind,
} from "@luke/features/task-wire";
import { Effect, Option } from "effect";
import { SqlClient } from "effect/sql";

/** Why a relation was not moved, nothing written: the block's refusals, or the parent's. */
export type TaskRelationRefused =
  | TaskBlockSelf
  | TaskBlockAcrossWorkspaces
  | TaskBlockCycle
  | TaskParentUnreached
  | TaskParentRepositoryDiffers
  | TaskParentCycle;

/** What a relation's write answers: the transaction it was written in, where it changed a row; none where it stood as asked already. */
type Written = Effect.Effect<Option.Option<TaskBlockWritten>, StoreFailure, DatabaseServices>;

/** The block a kind names between the task and the other, where the kind is a block's side. */
function blockPairOf(taskId: string, otherId: string, kind: TaskRelationKind): TaskBlockPair {
  return kind === TASK_RELATION_KIND.BLOCKED_BY
    ? { blockerTaskId: otherId, blockedTaskId: taskId }
    : { blockerTaskId: taskId, blockedTaskId: otherId };
}

/** The transaction a parent write committed in, as a block's write answers it. */
const parentWritten = (
  userId: string,
  childId: string,
  parentTaskId: string | null,
): Effect.Effect<
  Option.Option<TaskBlockWritten>,
  StoreFailure | TaskParentUnreached | TaskParentRepositoryDiffers | TaskParentCycle,
  DatabaseServices
> =>
  Effect.map(
    setTaskParent(userId, childId, parentTaskId),
    Option.map(({ txid }) => (txid === undefined ? {} : { txid })),
  );

/** The child's parent cleared where it is the parent named, and left alone where it is another's; nothing where the child is out of reach. */
const parentCleared = (userId: string, childId: string, parentTaskId: string): Written =>
  Effect.flatMap(readTaskHeader(userId, childId), (header) => {
    if (Option.isNone(header)) return Effect.succeed(Option.none());
    if (header.value.parentTaskId !== parentTaskId) return Effect.succeed(Option.some({}));
    // A clear never fails for a task reached, so its failures are the store's alone.
    return Effect.catchTags(parentWritten(userId, childId, null), {
      TaskParentUnreached: Effect.die,
      TaskParentRepositoryDiffers: Effect.die,
      TaskParentCycle: Effect.die,
    });
  });

/** The relation as it stood taken away: the block on that side, or the parent that stood, left alone where it did not. */
function relationTakenAway(
  userId: string,
  taskId: string,
  otherId: string,
  kind: TaskRelationKind,
): Written {
  switch (kind) {
    case TASK_RELATION_KIND.BLOCKED_BY:
    case TASK_RELATION_KIND.BLOCKS:
      return removeTaskBlock(userId, blockPairOf(taskId, otherId, kind));
    case TASK_RELATION_KIND.SUB_TASK:
      return parentCleared(userId, otherId, taskId);
    case TASK_RELATION_KIND.PARENT:
      return parentCleared(userId, taskId, otherId);
  }
}

/** The relation added in its new kind: a block on that side, the other made the task's child, or the task made the other's. */
function relationAdded(
  userId: string,
  taskId: string,
  otherId: string,
  kind: TaskRelationKind,
): Effect.Effect<
  Option.Option<TaskBlockWritten>,
  StoreFailure | TaskRelationRefused,
  DatabaseServices
> {
  switch (kind) {
    case TASK_RELATION_KIND.BLOCKED_BY:
    case TASK_RELATION_KIND.BLOCKS:
      return addTaskBlock(userId, blockPairOf(taskId, otherId, kind));
    case TASK_RELATION_KIND.SUB_TASK:
      return parentWritten(userId, otherId, taskId);
    case TASK_RELATION_KIND.PARENT:
      return parentWritten(userId, taskId, otherId);
  }
}

/**
 * Moves the relation between the task and the other from the kind it stood
 * in to the kind asked, for the account, answering the transaction the
 * move was written in, none where nothing changed; nothing where the
 * account reaches either task not. Note that both tasks are locked for
 * update first, in id order, so the two writes find their rows held and
 * take no lock another call's writes wait on crosswise.
 */
export function moveTaskRelation(
  userId: string,
  taskId: string,
  change: TaskRelationChangeRequest,
): Effect.Effect<
  Option.Option<TaskBlockWritten>,
  StoreFailure | TaskRelationRefused,
  DatabaseServices
> {
  const otherId = change.taskId;
  if (otherId === taskId) return Effect.fail(new TaskBlockSelf());
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const reached = yield* lockTasksForBlocks(userId, [taskId, otherId]);
        if (reached !== 2) return Option.none();
        const removed = yield* relationTakenAway(userId, taskId, otherId, change.from);
        if (Option.isNone(removed)) return Option.none();
        const added = yield* relationAdded(userId, taskId, otherId, change.to);
        if (Option.isNone(added)) return Option.none();
        const txid = added.value.txid ?? removed.value.txid;
        return Option.some(txid === undefined ? {} : { txid });
      }),
    ),
  );
}
