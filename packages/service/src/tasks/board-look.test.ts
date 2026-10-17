import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  boardImageLiveStatement,
  writeDrawing,
  writeScene,
} from "@luke/database/models/board-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, startTask } from "@luke/database/testing";
import { BOARD_ELEMENT_TYPE } from "@luke/features/board-vocabulary";
import { unparsedWire } from "@luke/wire";
import { Effect, Option } from "effect";
import { SqlClient } from "effect/sql";
import { driven, forkClockDriven } from "../testing/clock-driven.js";
import { BOARD_LOOK_WAIT, LOOK_AT_BOARD_STATUS, runLookAtBoard } from "./board-look.js";

/**
 * The planning model's look at its latest drawing: the Mac's first save of
 * the scene holding a drawing carries the scene's image, and the look answers
 * that image, or that none landed because the board is not open. The Mac is
 * played by the store's own scene write, the call its board route makes.
 *
 * A synthetic account and a stand-in for the image throughout.
 */

const IMAGE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk";

const BOX = [{ type: BOARD_ELEMENT_TYPE.RECTANGLE, id: "api", x: 0, y: 0, label: "API" }] as const;
const SCENE = [
  { id: "api", type: BOARD_ELEMENT_TYPE.RECTANGLE, x: 0, y: 0, width: 200, height: 80 },
];

/** An account holding one plan, and the binding a planning call runs under. */
const openTask = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const started = yield* startTask(userId, { name: "Teammate invitations" });
  return { userId, taskId: started.id, binding: { userId, taskId: started.id } };
});

it.layer(getTestDB())("look_at_board", (it) => {
  it.effect("another account's plan shows nothing", () =>
    Effect.gen(function* () {
      const { userId, taskId } = yield* openTask;
      const stranger = (yield* openTask).userId;
      yield* writeDrawing(userId, taskId, BOX);
      yield* writeScene(userId, taskId, SCENE, 1, IMAGE);

      const look = yield* forkClockDriven(
        runLookAtBoard({ userId: stranger, taskId }, unparsedWire({})),
      );
      const answered = yield* driven(look, BOARD_LOOK_WAIT.DEADLINE);

      assert.equal(answered.status, LOOK_AT_BOARD_STATUS.NOT_LOOKED);
    }),
  );
  it.effect(
    "the statement Realtime wakes a look on moves as Luke draws and the Mac saves the scene, carries no image, and reads nothing of another account's plan",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const { userId, taskId } = yield* openTask;
        const stranger = (yield* openTask).userId;
        const rows = (reader: string) => {
          const statement = Option.getOrThrow(boardImageLiveStatement(reader, taskId));
          return sql.unsafe(statement.sql, [...statement.params]);
        };
        const before = yield* rows(userId);
        yield* writeDrawing(userId, taskId, BOX);
        const drawn = yield* rows(userId);
        yield* writeScene(userId, taskId, SCENE, 1, IMAGE);
        const saved = yield* rows(userId);

        assert.notDeepEqual(drawn, before);
        assert.notDeepEqual(saved, drawn);
        assert.ok(!JSON.stringify(saved).includes(IMAGE));
        assert.deepEqual(yield* rows(stranger), []);
      }),
  );
});
