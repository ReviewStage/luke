import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { unparsedWire } from "@sidecar/wire";
import { eq } from "drizzle-orm";
import { type Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { test } from "vitest";
import { user } from "../server/db/auth-schema";
import { planBoardLook } from "../server/db/plan-schema";
import { db } from "../server/db/query";
import {
  BOARD_LOOK_WAIT,
  claimBoardLook,
  LOOK_AT_BOARD_REFUSAL,
  LOOK_AT_BOARD_STATUS,
  lookModelOutput,
  runLookAtBoard,
  settleBoardLook,
  storedLookOutput,
} from "../server/hosted/board-look";
import { createPlan } from "../server/hosted/plan-store";
import { testSqlClient } from "./support/sql-client";

/**
 * The planning model's look at the plan's whiteboard, drawn on the
 * developer's Mac: the tool queues a look under the plan, the Mac claims it
 * and settles it with the board it drew, and the tool answers the image, or
 * that the Mac never drew one. The Mac is played by the store's own claim
 * and settle, the calls its two routes make. What the model is shown of the
 * answer, and what the conversation keeps of it, are read beside.
 *
 * A synthetic account and a one-pixel stand-in for the image throughout.
 */

const IMAGE =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** An account holding one plan, and the binding a planning call runs under. */
const openPlan = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const started = yield* createPlan(userId, { name: "Teammate invitations" });
  return { userId, planId: started.id, binding: { userId, planId: started.id } };
});

/** The plan's first look, once the forked tool's insert has landed. */
const queuedLook = (planId: string) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const [first] = yield* db
        .select({ id: planBoardLook.id })
        .from(planBoardLook)
        .where(eq(planBoardLook.planId, planId));
      if (first !== undefined) return first;
      yield* Effect.yieldNow;
    }
    return assert.fail("the tool never queued its look");
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

it.layer(testSqlClient)("look_at_board on the Mac", (it) => {
  it.effect("a look the Mac claims and settles answers the board it drew", () =>
    Effect.gen(function* () {
      const { userId, planId, binding } = yield* openPlan;

      const tool = yield* Effect.forkChild(runLookAtBoard(binding, unparsedWire({})));
      const queued = yield* queuedLook(planId);
      const claimed = yield* claimBoardLook(userId, planId);
      const settled = yield* settleBoardLook(userId, planId, queued.id, { image: IMAGE });
      const answered = yield* driven(tool, BOARD_LOOK_WAIT.RESULT_POLL);

      assert.deepEqual(claimed, { id: queued.id });
      assert.equal(settled, true);
      assert.deepEqual(answered, { status: LOOK_AT_BOARD_STATUS.LOOKED, image: IMAGE });
    }),
  );

  it.effect("a look the Mac could not draw answers why", () =>
    Effect.gen(function* () {
      const { userId, planId, binding } = yield* openPlan;

      const tool = yield* Effect.forkChild(runLookAtBoard(binding, unparsedWire({})));
      const queued = yield* queuedLook(planId);
      yield* claimBoardLook(userId, planId);
      yield* settleBoardLook(userId, planId, queued.id, { failure: "the board is empty." });
      const answered = yield* driven(tool, BOARD_LOOK_WAIT.RESULT_POLL);

      assert.equal(answered.status, LOOK_AT_BOARD_STATUS.NOT_LOOKED);
      assert.match("reason" in answered ? answered.reason : "", /the board is empty/);
    }),
  );

  it.effect(
    "a look no Mac answers by the deadline answers at once, and no late Mac claims it",
    () =>
      Effect.gen(function* () {
        const { userId, planId, binding } = yield* openPlan;

        const tool = yield* Effect.forkChild(runLookAtBoard(binding, unparsedWire({})));
        yield* queuedLook(planId);
        const answered = yield* driven(tool, BOARD_LOOK_WAIT.RESULT_DEADLINE);
        const late = yield* Effect.forkChild(claimBoardLook(userId, planId));
        const lateClaimed = yield* driven(late, BOARD_LOOK_WAIT.CLAIM_HOLD);

        assert.deepEqual(answered, {
          status: LOOK_AT_BOARD_STATUS.NOT_LOOKED,
          reason: LOOK_AT_BOARD_REFUSAL.NO_ANSWER,
        });
        assert.equal(lateClaimed, null);
      }),
  );

  it.effect("a look is claimed once, and never claimed or settled by another account", () =>
    Effect.gen(function* () {
      const { userId, planId, binding } = yield* openPlan;
      const stranger = (yield* openPlan).userId;
      const tool = yield* Effect.forkChild(runLookAtBoard(binding, unparsedWire({})));
      const queued = yield* queuedLook(planId);

      // The stranger's claim polls a few times inside the look's wait and finds nothing it may take.
      const strangerClaim = yield* Effect.forkChild(claimBoardLook(stranger, planId));
      for (let poll = 0; poll < 10; poll += 1) {
        yield* TestClock.adjust(BOARD_LOOK_WAIT.CLAIM_POLL);
        yield* Effect.yieldNow;
      }
      const strangerClaimed = strangerClaim.pollUnsafe() === undefined ? null : "claimed";
      yield* Fiber.interrupt(strangerClaim);
      const first = yield* claimBoardLook(userId, planId);
      const strangerSettled = yield* settleBoardLook(stranger, planId, queued.id, {
        image: IMAGE,
      });
      yield* Fiber.interrupt(tool);

      assert.equal(strangerClaimed, null);
      assert.equal(first?.id, queued.id);
      assert.equal(strangerSettled, false);
    }),
  );

  it.effect("arguments queue nothing", () =>
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
  assert.equal(looked.type, "content");
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
