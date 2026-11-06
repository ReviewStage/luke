import {
  addTaskBlock,
  readTaskBlocks,
  removeTaskBlock,
  type TaskBlockPair,
} from "@repo/database/models/task-block-store";
import { readTaskHeaders } from "@repo/database/models/task-store";
import { describeWire } from "@repo/wire/effect";
import { Data, Effect, Option, Result, Schema } from "effect";
import { wireUuidSchema } from "../core.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import { writtenTaskMention } from "./written-mentions.js";

const MAX_TASKS_PER_LIST = 50;

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

export const BLOCKED_BY_INPUT = blockChangesInput("blocked-by (the tasks it waits on)");

export const BLOCKS_INPUT = blockChangesInput("blocks (the tasks that wait on it)");

interface BlockSideChanges {
  readonly add?: readonly string[];
  readonly remove?: readonly string[];
}

export interface TaskBlockChanges {
  readonly blockedBy?: BlockSideChanges;
  readonly blocks?: BlockSideChanges;
}

export interface TaskBlockWrites {
  readonly removes: readonly TaskBlockPair[];
  readonly adds: readonly TaskBlockPair[];
}

export class TaskBlockRefused extends Data.TaggedError("TaskBlockRefused")<{
  readonly words: string;
}> {}

type TaskBlockReading = {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly mention: string;
};

export function blockChangesNamed(changes: TaskBlockChanges): boolean {
  return changes.blockedBy !== undefined || changes.blocks !== undefined;
}

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

export const blockWritesAsked = (
  userId: string,
  workspaceId: string,
  taskId: string,
  changes: TaskBlockChanges,
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
    const headers = yield* readTaskHeaders(userId, [...others]);
    for (const otherId of others) {
      if (headers.get(otherId)?.workspaceId !== workspaceId) {
        return Result.fail(TASK_BLOCK_REFUSAL.NO_TASK);
      }
    }
    return Result.succeed(writes);
  });

export function tasksOfWrites(writes: TaskBlockWrites): string[] {
  return [...writes.removes, ...writes.adds].flatMap((pair) => [
    pair.blockerTaskId,
    pair.blockedTaskId,
  ]);
}

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

const readingsOf = (userId: string, taskIds: readonly string[], step: string) =>
  Effect.map(readTaskHeaders(userId, taskIds), (headers) =>
    taskIds.flatMap((taskId): TaskBlockReading[] => {
      const header = headers.get(taskId);
      if (header === undefined) return [];
      const { name, status, number } = header;
      return [
        {
          id: taskId,
          name,
          status,
          mention: writtenTaskMention({ id: taskId, number }, name, step),
        },
      ];
    }),
  );

export const taskBlockReadings = (
  userId: string,
  blocks: { readonly blockedBy?: readonly string[]; readonly blocks?: readonly string[] },
  step: string,
) =>
  Effect.all({
    blockedBy: readingsOf(userId, blocks.blockedBy ?? [], step),
    blocks: readingsOf(userId, blocks.blocks ?? [], step),
  });

export const taskBlockReadingsNow = (userId: string, taskId: string, step: string) =>
  Effect.flatMap(readTaskBlocks(userId, taskId), (read) =>
    taskBlockReadings(
      userId,
      Option.getOrElse(read, () => ({ blockedBy: [], blocks: [] })),
      step,
    ),
  );
