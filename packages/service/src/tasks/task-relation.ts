import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import {
  addTaskBlock,
  lockTasksForBlocks,
  removeTaskBlock,
  type TaskBlockAcrossWorkspaces,
  type TaskBlockCycle,
  type TaskBlockPair,
  TaskBlockSelf,
  type TaskBlockWritten,
} from "@repo/database/models/task-block-store";
import {
  readTaskHeader,
  setTaskParent,
  type TaskParentCycle,
  type TaskParentRepositoryDiffers,
  type TaskParentUnreached,
} from "@repo/database/models/task-store";
import {
  TASK_RELATION_KIND,
  type TaskRelationChangeRequest,
  type TaskRelationKind,
} from "@repo/features/task-wire";
import { Effect, Option } from "effect";
import { SqlClient } from "effect/sql";

export type TaskRelationRefused =
  | TaskBlockSelf
  | TaskBlockAcrossWorkspaces
  | TaskBlockCycle
  | TaskParentUnreached
  | TaskParentRepositoryDiffers
  | TaskParentCycle;

type Written = Effect.Effect<Option.Option<TaskBlockWritten>, StoreFailure, DatabaseServices>;

function blockPairOf(taskId: string, otherId: string, kind: TaskRelationKind): TaskBlockPair {
  return kind === TASK_RELATION_KIND.BLOCKED_BY
    ? { blockerTaskId: otherId, blockedTaskId: taskId }
    : { blockerTaskId: taskId, blockedTaskId: otherId };
}

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

const parentCleared = (userId: string, childId: string, parentTaskId: string): Written =>
  Effect.flatMap(readTaskHeader(userId, childId), (header) => {
    if (Option.isNone(header)) return Effect.succeed(Option.none());
    if (header.value.parentTaskId !== parentTaskId) return Effect.succeed(Option.some({}));
    return Effect.catchTags(parentWritten(userId, childId, null), {
      TaskParentUnreached: Effect.die,
      TaskParentRepositoryDiffers: Effect.die,
      TaskParentCycle: Effect.die,
    });
  });

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
