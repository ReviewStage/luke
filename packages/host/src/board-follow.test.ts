import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { LIVE_POLL_URL, type TaskBoardLiveAnswer } from "@luke/features/live-wire";
import { Duration, Effect, Exit, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import { boardMoves } from "./board-follow.js";
import { LiveBroken } from "./live-follow.js";

/**
 * A task's board followed over the service's held poll answers its rows on
 * the first answer and on each that moved its mark, none for an answer that
 * left it where it stood, and fails on a row that does not decode.
 */

const TASK = "0b3c8a40-4b8e-4a5e-9f7a-2d1c3b4a5e6f";

/** The board as the service answers it polled, its rows inline. */
const polled = (rows: readonly unknown[]): TaskBoardLiveAnswer => ({
  url: LIVE_POLL_URL,
  queries: {
    board: { capability: LIVE_POLL_URL, queryFingerprint: LIVE_POLL_URL, expiresAt: 0, rows },
  },
});

/** Every step the follow has to take, taken. */
const settled = Effect.repeat(
  Effect.andThen(
    Effect.yieldNow,
    Effect.promise(() => Promise.resolve()),
  ),
  { times: 20 },
);

const mark = (drawingNumber: number, appliedDrawing: number, imaged: boolean) => ({
  taskId: TASK,
  drawingNumber,
  appliedDrawing,
  imaged,
});

/** The board followed from `first`, each poll answering the next of `answers`, and the last of them once they run out. */
const follow = (first: TaskBoardLiveAnswer, answers: TaskBoardLiveAnswer[] = []) => {
  let last = first;
  return boardMoves(
    {
      poll: () =>
        Effect.sync(() => {
          last = answers.shift() ?? last;
          return last;
        }),
    },
    first,
  );
};

it.effect("answers the first answer and each that moved the mark, and none that did not", () =>
  Effect.gen(function* () {
    const answers = [
      polled([]),
      polled([mark(1, 0, false)]),
      polled([mark(1, 0, false)]),
      polled([mark(1, 1, true)]),
    ];
    const moves = yield* Effect.forkChild(
      follow(polled([]), answers).pipe(Stream.take(3), Stream.runCollect),
    );
    for (let poll = 0; poll < 5; poll += 1) {
      yield* settled;
      yield* TestClock.adjust(Duration.millis(500));
    }

    assert.deepEqual(yield* Fiber.join(moves), [
      { board: [] },
      { board: [mark(1, 0, false)] },
      { board: [mark(1, 1, true)] },
    ]);
  }),
);

it.effect("fails where a row does not decode", () =>
  Effect.gen(function* () {
    const moves = yield* Effect.forkChild(
      follow(polled([{ taskId: TASK, drawingNumber: "one" }])).pipe(Stream.runDrain),
    );
    yield* settled;

    assert.deepEqual(
      yield* Fiber.await(moves),
      Exit.fail(new LiveBroken({ reason: "a row did not decode" })),
    );
  }),
);
