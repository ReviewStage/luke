import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  PLAN_COMMENTS_CURSOR_START,
  type PlanCommentThread,
} from "@luke/features/plan-comment-wire";
import {
  PLAN_COMMENT_CALL_FAILURE,
  type TasksCommentsAnswer,
  type TasksCommentsParams,
} from "@luke/features/tasks-view";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { commentsPoll } from "./plan-comments.js";

/**
 * The plan's comments poll over a scripted service: each read answers the
 * next scripted answer, a rejection where one is `undefined`, and holds once
 * the script runs out, as the service holds a read while nothing changed.
 * Synthetic plan and thread; the clock is the test's own.
 */

const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

const THREAD: PlanCommentThread = {
  id: "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11",
  scope: PLAN_COMMENT_SCOPE.WORDS,
  quote: "a retry",
  anchor: { from: 20, to: 27 },
  section: "Testing",
  status: PLAN_COMMENT_STATUS.OPEN,
  createdAt: 1,
  updatedAt: 1,
  revision: 1,
  entries: [],
};

const UNANSWERED: TasksCommentsAnswer = { failure: PLAN_COMMENT_CALL_FAILURE.UNANSWERED };

/** Lets the poll's reads settle between steps. */
const settle = Effect.repeat(Effect.yieldNow, { times: 20 });

/** A poll over the scripted answers, with what it asked, took, and missed. */
function service(...answers: (TasksCommentsAnswer | undefined)[]) {
  const asked: string[] = [];
  const took: (readonly PlanCommentThread[])[] = [];
  let missed = 0;
  const read = (params: TasksCommentsParams): Promise<TasksCommentsAnswer> => {
    const index = asked.length;
    asked.push(params.after);
    if (index >= answers.length) return Promise.withResolvers<never>().promise;
    const answer = answers[index];
    return answer === undefined
      ? Promise.reject(new Error("port closed"))
      : Promise.resolve(answer);
  };
  return {
    asked,
    took,
    missed: () => missed,
    poll: commentsPoll({
      planId: PLAN,
      read,
      took: (threads) => took.push(threads),
      missed: () => {
        missed += 1;
      },
    }),
  };
}

it.effect("a read that did not answer is said, and the comments read again land", () =>
  Effect.gen(function* () {
    const fake = service(UNANSWERED, { threads: [THREAD], cursor: "c1" });
    const fiber = yield* Effect.forkChild(fake.poll);
    yield* settle;
    assert.equal(fake.missed(), 1);
    assert.deepEqual(fake.took, []);

    yield* TestClock.adjust("1 second");
    yield* settle;
    assert.deepEqual(fake.took, [[THREAD]]);
    // The next read holds past the cursor the answer named.
    assert.deepEqual(fake.asked, [PLAN_COMMENTS_CURSOR_START, PLAN_COMMENTS_CURSOR_START, "c1"]);
    yield* Fiber.interrupt(fiber);
  }),
);

it.effect("a read that threw after one answered asks from the start after the first wait", () =>
  Effect.gen(function* () {
    const fake = service(undefined, undefined, { threads: [], cursor: "c1" }, undefined, {
      threads: [THREAD],
      cursor: "c2",
    });
    const fiber = yield* Effect.forkChild(fake.poll);
    yield* settle;
    yield* TestClock.adjust("1 second");
    yield* settle;
    yield* TestClock.adjust("2 seconds");
    yield* settle;
    assert.deepEqual(fake.took, [[]]);
    assert.equal(fake.missed(), 3);

    // An answer starts the wait over, so the miss after it is asked again after one second.
    yield* TestClock.adjust("1 second");
    yield* settle;
    assert.deepEqual(fake.took, [[], [THREAD]]);
    assert.deepEqual(fake.asked.slice(3), ["c1", PLAN_COMMENTS_CURSOR_START, "c2"]);
    yield* Fiber.interrupt(fiber);
  }),
);
