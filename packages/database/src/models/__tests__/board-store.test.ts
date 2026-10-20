import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { BOARD_ELEMENT_TYPE } from "@luke/features/board-vocabulary";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { Effect, Option } from "effect";
import { SqlClient } from "effect/sql";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import { boardLiveStatement, writeDrawing, writeScene } from "../board-store.js";
import { createTask } from "../task-store.js";

/**
 * Where a task's board stands as Neon Realtime reads it, over a real
 * dialect: a member of the task's workspace reads one row that moves as
 * Luke draws and as a save lands the drawing and its image, and an account
 * outside the workspace reads none, nor does a member who does not reach
 * the repository of a task on its owner's own GitHub token.
 *
 * Synthetic accounts, drawings, and a stand-in for the image throughout.
 */

const BOX = [{ type: BOARD_ELEMENT_TYPE.RECTANGLE, id: "api", x: 0, y: 0, label: "API" }] as const;
const SCENE = [
  { id: "api", type: BOARD_ELEMENT_TYPE.RECTANGLE, x: 0, y: 0, width: 200, height: 80 },
];
const IMAGE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk";

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** The board's live statement run as Realtime runs it, its SQL and values as they are. */
const liveRows = (userId: string, taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const statement = Option.getOrThrow(boardLiveStatement(userId, taskId));
    return yield* sql.unsafe(statement.sql, [...statement.params]);
  });

it.layer(getTestDB())("a board's live statement", (it) => {
  it.effect(
    "a member reads one row that moves as Luke draws and a save lands the drawing and its image, and an outsider reads none",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        yield* openWorkspace(outsider);
        const task = yield* createTask(owner, { organizationId: workspace, name: "Invitations" });

        assert.deepEqual(yield* liveRows(teammate, task.id), [], "no board, no row");

        yield* writeDrawing(owner, task.id, BOX);
        assert.deepEqual(yield* liveRows(teammate, task.id), [
          { taskId: task.id, drawingNumber: 1, appliedDrawing: 0, imaged: false },
        ]);

        yield* writeScene(owner, task.id, SCENE, 1, IMAGE);
        assert.deepEqual(yield* liveRows(teammate, task.id), [
          { taskId: task.id, drawingNumber: 1, appliedDrawing: 1, imaged: true },
        ]);

        assert.deepEqual(yield* liveRows(outsider, task.id), [], "an outsider reads nothing");
      }),
  );

  it.effect(
    "a task on its owner's own GitHub token is read by its owner, and not by a member whose access does not reach its repository",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        const task = yield* createTask(owner, {
          organizationId: workspace,
          name: "Side project",
          repository: "octo-member/side",
          githubAccess: GITHUB_ACCESS.TOKEN,
        });
        yield* writeDrawing(owner, task.id, BOX);

        assert.deepEqual(yield* liveRows(owner, task.id), [
          { taskId: task.id, drawingNumber: 1, appliedDrawing: 0, imaged: false },
        ]);
        assert.deepEqual(yield* liveRows(teammate, task.id), []);
      }),
  );
});
