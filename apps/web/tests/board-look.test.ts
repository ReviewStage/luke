import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { BOARD_ELEMENT_TYPE } from "@sidecar/hosted/board-vocabulary";
import { unparsedWire } from "@sidecar/wire";
import { type Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { test } from "vitest";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import {
  BOARD_LOOK_WAIT,
  LOOK_AT_BOARD_REFUSAL,
  LOOK_AT_BOARD_STATUS,
  lookModelOutput,
  runLookAtBoard,
  storedLookOutput,
} from "../server/hosted/board-look";
import { writeDrawing, writeScene } from "../server/hosted/board-store";
import { createPlan } from "../server/hosted/plan-store";
import { testSqlClient } from "./support/sql-client";

/**
 * The planning model's look at its latest drawing: the Mac's first save of
 * the scene holding a drawing carries the scene's image, and the look answers
 * that image, or that none landed because the board is not open. The Mac is
 * played by the store's own scene write, the call its board route makes.
 *
 * A synthetic account and a stand-in for the image throughout.
 */

const IMAGE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk";
const OLDER_IMAGE = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk";

const BOX = [{ type: BOARD_ELEMENT_TYPE.RECTANGLE, id: "api", x: 0, y: 0, label: "API" }] as const;
const SCENE = [
  { id: "api", type: BOARD_ELEMENT_TYPE.RECTANGLE, x: 0, y: 0, width: 200, height: 80 },
];

/** An account holding one plan, and the binding a planning call runs under. */
const openPlan = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const started = yield* createPlan(userId, { name: "Teammate invitations" });
  return { userId, planId: started.id, binding: { userId, planId: started.id } };
});

/** A forked effect driven to its end, the clock moved a step at a time so each wait it holds elapses. */
const driven = <A, E>(fiber: Fiber.Fiber<A, E>, step: Duration.Duration) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      if (fiber.pollUnsafe() !== undefined) return yield* Fiber.join(fiber);
      yield* TestClock.adjust(step);
      yield* Effect.yieldNow;
    }
    return yield* Fiber.join(fiber);
  });

it.layer(testSqlClient)("look_at_board", (it) => {
  it.effect("a look answers the image the Mac's save of the latest drawing carried", () =>
    Effect.gen(function* () {
      const { userId, planId, binding } = yield* openPlan;
      yield* writeDrawing(userId, planId, BOX);

      const look = yield* Effect.forkChild(runLookAtBoard(binding, unparsedWire({})));
      yield* writeScene(userId, planId, SCENE, 1, IMAGE);
      const answered = yield* driven(look, BOARD_LOOK_WAIT.POLL);

      assert.deepEqual(answered, { status: LOOK_AT_BOARD_STATUS.LOOKED, image: IMAGE });
    }),
  );

  it.effect("a look waits out the image of an older drawing, and says the board is not open", () =>
    Effect.gen(function* () {
      const { userId, planId, binding } = yield* openPlan;
      yield* writeDrawing(userId, planId, BOX);
      yield* writeScene(userId, planId, SCENE, 1, OLDER_IMAGE);
      yield* writeDrawing(userId, planId, BOX);

      const look = yield* Effect.forkChild(runLookAtBoard(binding, unparsedWire({})));
      const answered = yield* driven(look, BOARD_LOOK_WAIT.DEADLINE);

      assert.deepEqual(answered, {
        status: LOOK_AT_BOARD_STATUS.NOT_LOOKED,
        reason: LOOK_AT_BOARD_REFUSAL.NOT_OPEN,
      });
    }),
  );

  it.effect("a later save with no image keeps the image of the drawing it still holds", () =>
    Effect.gen(function* () {
      const { userId, planId, binding } = yield* openPlan;
      yield* writeDrawing(userId, planId, BOX);
      yield* writeScene(userId, planId, SCENE, 1, IMAGE);
      yield* writeScene(userId, planId, [], 1);

      const answered = yield* runLookAtBoard(binding, unparsedWire({}));

      assert.deepEqual(answered, { status: LOOK_AT_BOARD_STATUS.LOOKED, image: IMAGE });
    }),
  );

  it.effect("a save of a new drawing that carried no image drops the old drawing's image", () =>
    Effect.gen(function* () {
      const { userId, planId, binding } = yield* openPlan;
      yield* writeDrawing(userId, planId, BOX);
      yield* writeScene(userId, planId, SCENE, 1, OLDER_IMAGE);
      yield* writeDrawing(userId, planId, BOX);
      yield* writeScene(userId, planId, SCENE, 2);

      const look = yield* Effect.forkChild(runLookAtBoard(binding, unparsedWire({})));
      const answered = yield* driven(look, BOARD_LOOK_WAIT.DEADLINE);

      assert.equal(answered.status, LOOK_AT_BOARD_STATUS.NOT_LOOKED);
    }),
  );

  it.effect("another account's plan shows nothing", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      const stranger = (yield* openPlan).userId;
      yield* writeDrawing(userId, planId, BOX);
      yield* writeScene(userId, planId, SCENE, 1, IMAGE);

      const look = yield* Effect.forkChild(
        runLookAtBoard({ userId: stranger, planId }, unparsedWire({})),
      );
      const answered = yield* driven(look, BOARD_LOOK_WAIT.DEADLINE);

      assert.equal(answered.status, LOOK_AT_BOARD_STATUS.NOT_LOOKED);
    }),
  );

  it.effect("arguments are refused", () =>
    Effect.gen(function* () {
      const { binding } = yield* openPlan;

      const answered = yield* runLookAtBoard(binding, unparsedWire({ zoom: 2 }));

      assert.deepEqual(answered, {
        status: LOOK_AT_BOARD_STATUS.NOT_LOOKED,
        reason: LOOK_AT_BOARD_REFUSAL.UNREADABLE,
      });
    }),
  );
});

test("the model is shown a look as the image itself, and any other result as its JSON", () => {
  const looked = lookModelOutput(
    unparsedWire({ status: LOOK_AT_BOARD_STATUS.LOOKED, image: IMAGE }),
  );
  const parts = looked.type === "content" ? looked.value : [];
  assert.ok(
    parts.some(
      (part) => part.type === "file" && part.mediaType === "image/png" && part.data.data === IMAGE,
    ),
  );
  const ran = { status: "ran", exitCode: 0, stdout: "", stderr: "" };
  assert.deepEqual(lookModelOutput(unparsedWire(ran)), { type: "json", value: ran });
});

test("the conversation keeps a look's status and never its image", () => {
  const kept = storedLookOutput(
    unparsedWire({ status: LOOK_AT_BOARD_STATUS.LOOKED, image: IMAGE }),
  );
  assert.deepEqual(kept, { status: LOOK_AT_BOARD_STATUS.LOOKED });
});
