import {
  addTaskBlock,
  readTaskBlocks,
  removeTaskBlock,
  type TaskBlockPair,
} from "@luke/database/models/task-block-store";
import { readTaskHeader } from "@luke/database/models/task-store";
import { MENTION_KIND } from "@luke/features/mention-link";
import { describeWire } from "@luke/wire/effect";
import { Data, Effect, Option, Result, Schema } from "effect";
import { wireUuidSchema } from "../core.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import { writtenMention } from "./written-mentions.js";

/**
 * task-block-changes.ts -- the blocks `update_task` adds and takes away, and the blocks `read_task` and its answer name.
 *
 * A block is Linear's: the blocker blocks the blocked task, which waits on
 * the blocker's work, and it is advice, never a lock. `update_task` names
 * the task it changes and, for its blocked-by and its blocks, the tasks to
 * add and the tasks to take away. Each other task is read first, on the
 * standing of the member the caller acts for, and must be a task of the
 * caller's workspace the caller may change; the writes then run through the
 * store (`task-block-store.ts`), which holds both tasks to one workspace
 * and refuses a block that would close a cycle, inside the caller's one
 * transaction, so a refusal takes back every change of the call.
 */

/** The most tasks one list of a call names, which a breakdown of child tasks stays well under. */
const MAX_TASKS_PER_LIST = 50;

/** Why a block changed nothing, in words the model can act on. */
export const TASK_BLOCK_REFUSAL = {
  NO_TASK:
    "Not run: a task named in blockedBy or blocks is no task of your workspace, so it is none " +
    `you can join to this one; ${AGENT_TOOL.LIST_TASKS} names them.`,
  SELF: "Not run: a task does not block itself; name another task in blockedBy and blocks.",
  CYCLE:
    "Not run: that block would close a cycle, since the task it would block already blocks the " +
    "blocker, directly or through other tasks; take away the block that runs the other way first.",
} as const;

const TASK_IDS = Schema.Array(wireUuidSchema).check(Schema.isMaxLength(MAX_TASKS_PER_LIST));

/** One side of a task's blocks as a call changes it: the tasks to add, and the tasks to take away. */
const blockChangesInput = (side: string) =>
  describeWire(
    Schema.Struct({
      add: Schema.optionalKey(
        describeWire(
          TASK_IDS,
          `Tasks to add to its ${side}, by the id ${AGENT_TOOL.LIST_TASKS} answered.`,
        ),
      ),
      remove: Schema.optionalKey(
        describeWire(
          TASK_IDS,
          `Tasks to take away from its ${side}; one that is not there is left as it is.`,
        ),
      ),
    }),
    `Its ${side}, changed: tasks to add and tasks to take away, each a task of your workspace.`,
  );

/** The tasks this one waits on, as `update_task` changes them. */
export const BLOCKED_BY_INPUT = blockChangesInput("blocked-by (the tasks it waits on)");

/** The tasks that wait on this one, as `update_task` changes them. */
export const BLOCKS_INPUT = blockChangesInput("blocks (the tasks that wait on it)");

/** One side of a task's blocks as a call carries it. */
interface BlockSideChanges {
  readonly add?: readonly string[];
  readonly remove?: readonly string[];
}

/** A task's blocks as a call changes them. */
export interface TaskBlockChanges {
  readonly blockedBy?: BlockSideChanges;
  readonly blocks?: BlockSideChanges;
}

/** The blocks a call writes: those it takes away, then those it adds. */
export interface TaskBlockWrites {
  readonly removes: readonly TaskBlockPair[];
  readonly adds: readonly TaskBlockPair[];
}

/** A block the store refused or a task it did not reach, which takes the call's transaction back; its words are the model's. */
export class TaskBlockRefused extends Data.TaggedError("TaskBlockRefused")<{
  readonly words: string;
}> {}

/** A task as a block names it to the model: its id, name, where it stands, and its mention; a type, so it reads as a wire record. */
type TaskBlockReading = {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly mention: string;
};

/** Whether the call names any change of a task's blocks. */
export function blockChangesNamed(changes: TaskBlockChanges): boolean {
  return changes.blockedBy !== undefined || changes.blocks !== undefined;
}

/** The pairs one side names, the task changed standing as the blocked task for its blocked-by and as the blocker for its blocks. */
function pairsOf(
  taskId: string,
  otherIds: readonly string[] | undefined,
  side: keyof TaskBlockChanges,
): TaskBlockPair[] {
  return (otherIds ?? []).map((otherId) =>
    side === "blockedBy"
      ? { blockerTaskId: otherId, blockedTaskId: taskId }
      : { blockerTaskId: taskId, blockedTaskId: otherId },
  );
}

/**
 * The blocks a call asks for, read before anything is written: every other
 * task it names a task of the workspace the caller may change, as
 * `refused` judges its owner's, or the refusal's words.
 */
export const blockWritesAsked = (
  userId: string,
  workspaceId: string,
  taskId: string,
  changes: TaskBlockChanges,
  refused: (task: { readonly ownerId: string }) => string | undefined,
) =>
  Effect.gen(function* () {
    const { blockedBy, blocks } = changes;
    const writes: TaskBlockWrites = {
      removes: [
        ...pairsOf(taskId, blockedBy?.remove, "blockedBy"),
        ...pairsOf(taskId, blocks?.remove, "blocks"),
      ],
      adds: [
        ...pairsOf(taskId, blockedBy?.add, "blockedBy"),
        ...pairsOf(taskId, blocks?.add, "blocks"),
      ],
    };
    const others = new Set(tasksOfWrites(writes));
    if (writes.adds.some((pair) => pair.blockerTaskId === pair.blockedTaskId)) {
      return Result.fail(TASK_BLOCK_REFUSAL.SELF);
    }
    others.delete(taskId);
    const headers = yield* Effect.forEach(others, (otherId) => readTaskHeader(userId, otherId));
    for (const header of headers) {
      if (Option.isNone(header) || header.value.workspaceId !== workspaceId) {
        return Result.fail(TASK_BLOCK_REFUSAL.NO_TASK);
      }
      const steward = refused(header.value);
      if (steward !== undefined) return Result.fail(steward);
    }
    return Result.succeed(writes);
  });

/** Every task the blocks asked name, the task changed among them. */
export function tasksOfWrites(writes: TaskBlockWrites): string[] {
  return [...writes.removes, ...writes.adds].flatMap((pair) => [
    pair.blockerTaskId,
    pair.blockedTaskId,
  ]);
}

/**
 * Writes the blocks asked, those taken away first, inside the caller's
 * transaction, answering whether any changed a row; a task gone or out of
 * reach meanwhile, or a block the store refuses, fails as `TaskBlockRefused`.
 */
export const writeTaskBlocks = (userId: string, writes: TaskBlockWrites) =>
  Effect.gen(function* () {
    let changed = false;
    for (const pair of writes.removes) {
      const removed = yield* removeTaskBlock(userId, pair);
      if (Option.isNone(removed))
        return yield* new TaskBlockRefused({ words: TASK_BLOCK_REFUSAL.NO_TASK });
      changed ||= removed.value.txid !== undefined;
    }
    for (const pair of writes.adds) {
      const added = yield* addTaskBlock(userId, pair).pipe(
        Effect.catchTags({
          TaskBlockSelf: () => new TaskBlockRefused({ words: TASK_BLOCK_REFUSAL.SELF }),
          TaskBlockAcrossWorkspaces: () =>
            new TaskBlockRefused({ words: TASK_BLOCK_REFUSAL.NO_TASK }),
          TaskBlockCycle: () => new TaskBlockRefused({ words: TASK_BLOCK_REFUSAL.CYCLE }),
        }),
      );
      if (Option.isNone(added))
        return yield* new TaskBlockRefused({ words: TASK_BLOCK_REFUSAL.NO_TASK });
      changed ||= added.value.txid !== undefined;
    }
    return changed;
  });

/** The tasks under these ids as the model reads them, in their order, each one the member reaches. */
const readingsOf = (userId: string, taskIds: readonly string[], step: string) =>
  Effect.map(
    Effect.forEach(taskIds, (taskId) =>
      Effect.map(readTaskHeader(userId, taskId), (header) =>
        Option.map(
          header,
          ({ name, status }): TaskBlockReading => ({
            id: taskId,
            name,
            status,
            mention: writtenMention({ kind: MENTION_KIND.TASK, taskId }, name, step),
          }),
        ),
      ),
    ),
    (read) => read.flatMap((reading) => Option.toArray(reading)),
  );

/**
 * The task's blocks as the model reads them: the tasks it waits on and the
 * tasks that wait on it, each one the member reaches, the earliest added
 * first, under the workspace's step for their mentions.
 */
export const taskBlockReadings = (
  userId: string,
  blocks: { readonly blockedBy?: readonly string[]; readonly blocks?: readonly string[] },
  step: string,
) =>
  Effect.all({
    blockedBy: readingsOf(userId, blocks.blockedBy ?? [], step),
    blocks: readingsOf(userId, blocks.blocks ?? [], step),
  });

/** The task's blocks as they now stand, read again after a write, as the model reads them; none where it is out of reach. */
export const taskBlockReadingsNow = (userId: string, taskId: string, step: string) =>
  Effect.flatMap(readTaskBlocks(userId, taskId), (read) =>
    taskBlockReadings(
      userId,
      Option.getOrElse(read, () => ({ blockedBy: [], blocks: [] })),
      step,
    ),
  );
