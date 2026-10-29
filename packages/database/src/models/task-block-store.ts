import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { Data, DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import {
  Database,
  type DatabaseServices,
  readConcurrency,
  type StoreFailure,
} from "../core/query.js";
import { task } from "../schemas/task.js";
import { taskBlock } from "../schemas/task-block.js";
import { reachableTask, taskReachableBy } from "./workspace-store.js";

/**
 * task-block-store.ts -- one task blocking another, read and written for the account that asks.
 *
 * A block joins two tasks of one workspace: the blocker, whose work the
 * blocked task waits on. Every statement names the account it runs for and
 * gates on its reach of each task it names (`taskReachableBy`), so a task
 * the account does not reach reads as no task and is never named in what
 * another task's blocks answer. A block is advice, as Linear's is: nothing
 * here refuses work on a blocked task. Every function is an effect over the
 * ambient `SqlClient` and names no database of its own.
 */

/** What a block store operation answers: an effect over the ambient client, failing as every store does or as `E` names. */
export type TaskBlockEffect<A, E = never> = Effect.Effect<A, StoreFailure | E, DatabaseServices>;

/** The two tasks a block joins: the blocker, and the task it blocks. */
export interface TaskBlockPair {
  readonly blockerTaskId: string;
  readonly blockedTaskId: string;
}

/** A task's blocks as its reader reads them, each task by its id, the earliest added first. */
export interface TaskBlocks {
  /** The tasks this one waits on. */
  readonly blockedBy: readonly string[];
  /** The tasks that wait on this one. */
  readonly blocks: readonly string[];
}

/** What a write of a block answers: the transaction it was written in, where it changed a row; none where the block stood as asked already. */
export interface TaskBlockWritten {
  readonly txid?: string;
}

/** The blocker and the blocked task are one task, which no task is to itself; nothing was written. */
export class TaskBlockSelf extends Data.TaggedError("TaskBlockSelf") {}

/** The blocker and the blocked task stand in two workspaces; nothing was written. */
export class TaskBlockAcrossWorkspaces extends Data.TaggedError("TaskBlockAcrossWorkspaces") {}

/**
 * The id of the transaction a write committed in, read in the write's own
 * `RETURNING`, as Neon's mutations guide says, so a client following the
 * task waits for that transaction to arrive before it confirms the write.
 */
const TXID = { txid: sql<string>`pg_current_xact_id()::text` };

const TxidRowSchema = Schema.Struct({ txid: Schema.String });

const IdRowSchema = Schema.Struct({ id: Schema.String });

const PairSchema = Schema.Struct({ blockerTaskId: Schema.String, blockedTaskId: Schema.String });

/** The task under this id, where the account reaches it; any other id reads as no task. */
const findReachableTask = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String }),
  Result: IdRowSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db.select({ id: task.id }).from(task).where(reachableTask(userId, taskId)).limit(1),
    ),
});

/**
 * The two tasks a write names, each where the account reaches it, under a
 * share lock, so neither moves to another workspace or goes while the
 * write stands on what it read.
 */
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

/** The tasks blocking this one that the account reaches, the earliest added first. */
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

/** The tasks this one blocks that the account reaches, the earliest added first. */
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

/** Every block naming the task, on either side, taken away. */
const deleteBlocksOf = SqlSchema.void({
  Request: Schema.String,
  execute: (taskId) =>
    Database.use((db) =>
      db
        .delete(taskBlock)
        .where(or(eq(taskBlock.blockerTaskId, taskId), eq(taskBlock.blockedTaskId, taskId))),
    ),
});

/** What a write answers from the row it wrote: its transaction, or nothing where it wrote none. */
function writtenOf(row: Option.Option<typeof TxidRowSchema.Type>): TaskBlockWritten {
  return Option.match(row, { onNone: () => ({}), onSome: ({ txid }) => ({ txid }) });
}

/**
 * The pair's two tasks, locked, in the one workspace they share, for a
 * write to run under; nothing where the account reaches either not, and a
 * failure where they are one task or stand in two workspaces.
 */
function lockedPair(
  userId: string,
  pair: TaskBlockPair,
): TaskBlockEffect<Option.Option<void>, TaskBlockSelf | TaskBlockAcrossWorkspaces> {
  return Effect.gen(function* () {
    if (pair.blockerTaskId === pair.blockedTaskId) return yield* new TaskBlockSelf();
    const taskIds = [pair.blockerTaskId, pair.blockedTaskId];
    const reached = yield* lockReachableTasks({ userId, taskIds });
    if (reached.length !== taskIds.length) return Option.none();
    const [first, second] = reached;
    if (first?.organizationId !== second?.organizationId) {
      return yield* new TaskBlockAcrossWorkspaces();
    }
    return Option.some(undefined);
  });
}

/**
 * The task's blocks, as the account reads them: the tasks blocking it and
 * the tasks it blocks, each one the account reaches, the earliest added
 * first. Nothing where the account does not reach the task.
 */
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

/**
 * Adds the block: the blocker blocks the blocked task. A block that stands
 * already stands as it was, and answers no transaction. Nothing where the
 * account reaches either task not.
 */
export function addTaskBlock(
  userId: string,
  pair: TaskBlockPair,
): TaskBlockEffect<Option.Option<TaskBlockWritten>, TaskBlockSelf | TaskBlockAcrossWorkspaces> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockedPair(userId, pair);
        if (Option.isNone(locked)) return Option.none();
        const now = yield* DateTime.nowAsDate;
        return Option.some(writtenOf(yield* insertBlock({ ...pair, now })));
      }),
    ),
  );
}

/**
 * Takes the block away. A block that does not stand answers no
 * transaction. Nothing where the account reaches either task not.
 */
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

/**
 * Takes away every block naming the task, on either side, as it moves to
 * another workspace: a block joins two tasks of one workspace, and the task
 * at its other end stays behind. Note that this runs in the move's own
 * transaction, under the task's lock, so a block added at once waits on that
 * lock and then reads the task in its new workspace and is refused.
 */
export function leaveTaskBlocks(taskId: string): TaskBlockEffect<void> {
  return deleteBlocksOf(taskId);
}
