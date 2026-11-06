import { TASK_STATUS } from "@repo/features/task-wire";
import { and, asc, eq, exists, inArray, notInArray, or, type SQL, sql } from "drizzle-orm";
import { Data, DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import {
  Database,
  type DatabaseServices,
  queryBuilder,
  readConcurrency,
  type StoreFailure,
} from "../core/query.js";
import { task } from "../schemas/task.js";
import { taskBlock } from "../schemas/task-block.js";
import { reachableTask, taskReachableBy } from "./workspace-store.js";

export type TaskBlockEffect<A, E = never> = Effect.Effect<A, StoreFailure | E, DatabaseServices>;

export interface TaskBlockPair {
  readonly blockerTaskId: string;
  readonly blockedTaskId: string;
}

export interface TaskBlocks {
  readonly blockedBy: readonly string[];
  readonly blocks: readonly string[];
}

export interface TaskBlockWritten {
  readonly txid?: string;
}

export class TaskBlockSelf extends Data.TaggedError("TaskBlockSelf") {}

export class TaskBlockAcrossWorkspaces extends Data.TaggedError("TaskBlockAcrossWorkspaces") {}

export class TaskBlockCycle extends Data.TaggedError("TaskBlockCycle") {}

const TXID = { txid: sql<string>`pg_current_xact_id()::text` };

const TxidRowSchema = Schema.Struct({ txid: Schema.String });

const SETTLED = [TASK_STATUS.DONE, TASK_STATUS.CANCELED];

const IdRowSchema = Schema.Struct({ id: Schema.String });

const PairSchema = Schema.Struct({ blockerTaskId: Schema.String, blockedTaskId: Schema.String });

const findReachableTask = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String }),
  Result: IdRowSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db.select({ id: task.id }).from(task).where(reachableTask(userId, taskId)).limit(1),
    ),
});

const lockReachableTasks = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, taskIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({ id: Schema.String, organizationId: Schema.String }),
  execute: ({ userId, taskIds }) =>
    Database.use((db) =>
      db
        .select({ id: task.id, organizationId: task.organizationId })
        .from(task)
        .where(and(inArray(task.id, taskIds), taskReachableBy(userId)))
        .orderBy(asc(task.id))
        .for("share"),
    ),
});

const lockReachableTasksForUpdate = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, taskIds: Schema.Array(Schema.String) }),
  Result: IdRowSchema,
  execute: ({ userId, taskIds }) =>
    Database.use((db) =>
      db
        .select({ id: task.id })
        .from(task)
        .where(and(inArray(task.id, taskIds), taskReachableBy(userId)))
        .orderBy(asc(task.id))
        .for("update"),
    ),
});

const findBlockers = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String }),
  Result: IdRowSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({ id: taskBlock.blockerTaskId })
        .from(taskBlock)
        .innerJoin(task, eq(task.id, taskBlock.blockerTaskId))
        .where(and(eq(taskBlock.blockedTaskId, taskId), taskReachableBy(userId)))
        .orderBy(asc(taskBlock.createdAt), asc(taskBlock.blockerTaskId)),
    ),
});

const findBlocked = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String }),
  Result: IdRowSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({ id: taskBlock.blockedTaskId })
        .from(taskBlock)
        .innerJoin(task, eq(task.id, taskBlock.blockedTaskId))
        .where(and(eq(taskBlock.blockerTaskId, taskId), taskReachableBy(userId)))
        .orderBy(asc(taskBlock.createdAt), asc(taskBlock.blockedTaskId)),
    ),
});

const insertBlock = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...PairSchema.fields, now: Schema.Date }),
  Result: TxidRowSchema,
  execute: ({ blockerTaskId, blockedTaskId, now }) =>
    Database.use((db) =>
      db
        .insert(taskBlock)
        .values({ blockerTaskId, blockedTaskId, createdAt: now })
        .onConflictDoNothing()
        .returning(TXID),
    ),
});

const findCycle = SqlSchema.findOneOption({
  Request: PairSchema,
  Result: IdRowSchema,
  execute: ({ blockerTaskId, blockedTaskId }) =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (client) => client`
        with recursive downstream(id) as (
          select blocked_task_id from task_block where blocker_task_id = ${blockedTaskId}
          union
          select block.blocked_task_id from task_block block
            join downstream on block.blocker_task_id = downstream.id
        )
        select id::text as id from downstream where id = ${blockerTaskId} limit 1`,
    ),
});

const deleteBlock = SqlSchema.findOneOption({
  Request: PairSchema,
  Result: TxidRowSchema,
  execute: ({ blockerTaskId, blockedTaskId }) =>
    Database.use((db) =>
      db
        .delete(taskBlock)
        .where(
          and(
            eq(taskBlock.blockerTaskId, blockerTaskId),
            eq(taskBlock.blockedTaskId, blockedTaskId),
          ),
        )
        .returning(TXID),
    ),
});

const deleteBlocksOf = SqlSchema.void({
  Request: Schema.String,
  execute: (taskId) =>
    Database.use((db) =>
      db
        .delete(taskBlock)
        .where(or(eq(taskBlock.blockerTaskId, taskId), eq(taskBlock.blockedTaskId, taskId))),
    ),
});

function writtenOf(row: Option.Option<typeof TxidRowSchema.Type>): TaskBlockWritten {
  return Option.match(row, { onNone: () => ({}), onSome: ({ txid }) => ({ txid }) });
}

function lockedPair(
  userId: string,
  pair: TaskBlockPair,
): TaskBlockEffect<Option.Option<string>, TaskBlockSelf | TaskBlockAcrossWorkspaces> {
  return Effect.gen(function* () {
    if (pair.blockerTaskId === pair.blockedTaskId) return yield* new TaskBlockSelf();
    const taskIds = [pair.blockerTaskId, pair.blockedTaskId];
    const reached = yield* lockReachableTasks({ userId, taskIds });
    if (reached.length !== taskIds.length) return Option.none();
    const [first, second] = reached;
    if (first === undefined || first.organizationId !== second?.organizationId) {
      return yield* new TaskBlockAcrossWorkspaces();
    }
    return Option.some(first.organizationId);
  });
}

export function taskBlockedFor(userId: string): SQL {
  const open = queryBuilder
    .select({ id: task.id })
    .from(task)
    .where(and(notInArray(task.status, SETTLED), taskReachableBy(userId)));
  return exists(
    queryBuilder
      .select({ one: sql`1` })
      .from(taskBlock)
      .where(and(eq(taskBlock.blockedTaskId, task.id), inArray(taskBlock.blockerTaskId, open))),
  );
}

export function readTaskBlocks(
  userId: string,
  taskId: string,
): TaskBlockEffect<Option.Option<TaskBlocks>> {
  return Effect.gen(function* () {
    const reached = yield* findReachableTask({ userId, taskId });
    if (Option.isNone(reached)) return Option.none();
    const { blockers, blocked } = yield* Effect.all(
      { blockers: findBlockers({ userId, taskId }), blocked: findBlocked({ userId, taskId }) },
      { concurrency: yield* readConcurrency },
    );
    return Option.some({
      blockedBy: blockers.map((row) => row.id),
      blocks: blocked.map((row) => row.id),
    });
  });
}

export function addTaskBlock(
  userId: string,
  pair: TaskBlockPair,
): TaskBlockEffect<
  Option.Option<TaskBlockWritten>,
  TaskBlockSelf | TaskBlockAcrossWorkspaces | TaskBlockCycle
> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const workspace = yield* lockedPair(userId, pair);
        if (Option.isNone(workspace)) return Option.none();
        yield* client`select pg_advisory_xact_lock(hashtextextended(${workspace.value}, 0))`;
        if (Option.isSome(yield* findCycle(pair))) return yield* new TaskBlockCycle();
        const now = yield* DateTime.nowAsDate;
        return Option.some(writtenOf(yield* insertBlock({ ...pair, now })));
      }),
    ),
  );
}

export function lockTasksForBlocks(
  userId: string,
  taskIds: readonly string[],
): TaskBlockEffect<number> {
  return Effect.map(
    lockReachableTasksForUpdate({ userId, taskIds: [...new Set(taskIds)] }),
    (rows) => rows.length,
  );
}

export function removeTaskBlock(
  userId: string,
  pair: TaskBlockPair,
): TaskBlockEffect<Option.Option<TaskBlockWritten>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const taskIds = [...new Set([pair.blockerTaskId, pair.blockedTaskId])];
        const reached = yield* lockReachableTasks({ userId, taskIds });
        if (reached.length !== taskIds.length) return Option.none();
        return Option.some(writtenOf(yield* deleteBlock(pair)));
      }),
    ),
  );
}

export function leaveTaskBlocks(taskId: string): TaskBlockEffect<void> {
  return deleteBlocksOf(taskId);
}
