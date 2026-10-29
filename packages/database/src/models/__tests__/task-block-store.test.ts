import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import {
  addTaskBlock,
  readTaskBlocks,
  removeTaskBlock,
  type TaskBlocks,
} from "../task-block-store.js";
import { createTask, deleteTask, readTaskPlan, updateTask } from "../task-store.js";

/**
 * One task blocking another, read and written through the store's public
 * functions over a real dialect: a block reads on both of its tasks, the
 * task's own read among them, goes with either task, joins only two tasks
 * of one workspace, and is read and written only by an account that reaches
 * both its tasks.
 *
 * Synthetic accounts, workspaces, and tasks throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** Dean's workspace with Charles a member of it, and two tasks Dean started there. */
const openSharedWorkspace = Effect.gen(function* () {
  const dean = yield* openAccount;
  const charles = yield* openAccount;
  const workspace = yield* openWorkspace(dean);
  yield* joinWorkspace(workspace, charles);
  const { id: schema } = yield* createTask(dean, { name: "Schema", organizationId: workspace });
  const { id: sidebar } = yield* createTask(dean, { name: "Sidebar", organizationId: workspace });
  return { dean, charles, workspace, schema, sidebar };
});

/** The task's blocks as the account reads them, which the test expects it to reach. */
const blocksOf = (userId: string, taskId: string) =>
  Effect.map(readTaskBlocks(userId, taskId), (read) =>
    Option.getOrElse(read, () => assert.fail("the task was not reached")),
  );

const NONE: TaskBlocks = { blockedBy: [], blocks: [] };

it.layer(getTestDB())("one task blocking another", (it) => {
  it.effect(
    "a block reads on both of its tasks, the task's own read among them, and adding it again writes nothing",
    () =>
      Effect.gen(function* () {
        const { dean, charles, schema, sidebar } = yield* openSharedWorkspace;
        const pair = { blockerTaskId: schema, blockedTaskId: sidebar };

        const added = yield* addTaskBlock(charles, pair);
        const again = yield* addTaskBlock(dean, pair);

        assert.ok(Option.getOrThrow(added).txid !== undefined);
        assert.deepEqual(again, Option.some({}));
        assert.deepEqual(yield* blocksOf(dean, sidebar), { blockedBy: [schema], blocks: [] });
        assert.deepEqual(yield* blocksOf(charles, schema), { blockedBy: [], blocks: [sidebar] });
        const opened = Option.getOrThrow(yield* readTaskPlan(charles, sidebar));
        assert.deepEqual([opened.blockedBy, opened.blocks], [[schema], []]);
      }),
  );

  it.effect(
    "a block taken away, gone with either of its tasks, or left as either moves to another workspace, reads on neither",
    () =>
      Effect.gen(function* () {
        const { dean, workspace, schema, sidebar } = yield* openSharedWorkspace;
        const elsewhere = yield* openWorkspace(dean);
        const { id: approve } = yield* createTask(dean, {
          name: "Approve",
          organizationId: workspace,
        });
        const { id: moving } = yield* createTask(dean, {
          name: "Moving",
          organizationId: workspace,
        });
        yield* addTaskBlock(dean, { blockerTaskId: schema, blockedTaskId: sidebar });
        yield* addTaskBlock(dean, { blockerTaskId: sidebar, blockedTaskId: approve });
        yield* addTaskBlock(dean, { blockerTaskId: moving, blockedTaskId: schema });

        const removed = yield* removeTaskBlock(dean, {
          blockerTaskId: schema,
          blockedTaskId: sidebar,
        });
        const removedAgain = yield* removeTaskBlock(dean, {
          blockerTaskId: schema,
          blockedTaskId: sidebar,
        });
        yield* deleteTask(dean, approve);
        yield* updateTask(dean, moving, { organizationId: elsewhere });

        assert.ok(Option.getOrThrow(removed).txid !== undefined);
        assert.deepEqual(removedAgain, Option.some({}));
        assert.deepEqual(yield* blocksOf(dean, schema), NONE);
        assert.deepEqual(yield* blocksOf(dean, sidebar), NONE);
        assert.deepEqual(yield* blocksOf(dean, moving), NONE);
      }),
  );

  it.effect(
    "no block closes a cycle, one through a task the writer does not reach among them",
    () =>
      Effect.gen(function* () {
        const { dean, charles, workspace, schema, sidebar } = yield* openSharedWorkspace;
        // Dean's own token reached this repository, which Charles's never read.
        const { id: hidden } = yield* createTask(dean, {
          name: "Hidden",
          organizationId: workspace,
          repository: "dean/side",
          githubAccess: GITHUB_ACCESS.TOKEN,
        });
        yield* addTaskBlock(dean, { blockerTaskId: schema, blockedTaskId: hidden });
        yield* addTaskBlock(dean, { blockerTaskId: hidden, blockedTaskId: sidebar });

        const closing = yield* Effect.flip(
          addTaskBlock(charles, { blockerTaskId: sidebar, blockedTaskId: schema }),
        );

        assert.equal(closing._tag, "TaskBlockCycle");
        assert.deepEqual(yield* blocksOf(dean, schema), { blockedBy: [], blocks: [hidden] });
      }),
  );

  it.effect("no task blocks itself or a task of another workspace", () =>
    Effect.gen(function* () {
      const { dean, schema } = yield* openSharedWorkspace;
      const elsewhere = yield* openWorkspace(dean);
      const { id: other } = yield* createTask(dean, { name: "Other", organizationId: elsewhere });

      const self = yield* Effect.flip(
        addTaskBlock(dean, { blockerTaskId: schema, blockedTaskId: schema }),
      );
      const across = yield* Effect.flip(
        addTaskBlock(dean, { blockerTaskId: schema, blockedTaskId: other }),
      );

      assert.deepEqual([self._tag, across._tag], ["TaskBlockSelf", "TaskBlockAcrossWorkspaces"]);
      assert.deepEqual(yield* blocksOf(dean, schema), NONE);
    }),
  );

  it.effect(
    "an account reads and writes no block of a task it does not reach, and reads none naming one",
    () =>
      Effect.gen(function* () {
        const { dean, charles, workspace, schema, sidebar } = yield* openSharedWorkspace;
        const outsider = yield* openAccount;
        yield* openWorkspace(outsider);
        // Dean's own token reached this repository, which Charles's never read.
        const { id: hidden } = yield* createTask(dean, {
          name: "Hidden",
          organizationId: workspace,
          repository: "dean/side",
          githubAccess: GITHUB_ACCESS.TOKEN,
        });
        yield* addTaskBlock(dean, { blockerTaskId: schema, blockedTaskId: sidebar });
        yield* TestClock.adjust("1 minute");
        yield* addTaskBlock(dean, { blockerTaskId: hidden, blockedTaskId: sidebar });

        const outsiderRead = yield* readTaskBlocks(outsider, sidebar);
        const outsiderAdd = yield* addTaskBlock(outsider, {
          blockerTaskId: sidebar,
          blockedTaskId: schema,
        });
        const outsiderRemove = yield* removeTaskBlock(outsider, {
          blockerTaskId: schema,
          blockedTaskId: sidebar,
        });
        const charlesRemove = yield* removeTaskBlock(charles, {
          blockerTaskId: hidden,
          blockedTaskId: sidebar,
        });

        assert.deepEqual(
          [outsiderRead, outsiderAdd, outsiderRemove],
          [Option.none(), Option.none(), Option.none()],
        );
        assert.deepEqual(charlesRemove, Option.none());
        assert.deepEqual(yield* blocksOf(charles, sidebar), { blockedBy: [schema], blocks: [] });
        assert.deepEqual(yield* blocksOf(dean, sidebar), {
          blockedBy: [schema, hidden],
          blocks: [],
        });
      }),
  );
});
