import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { TaskBoardLiveAnswer } from "@luke/features/live-wire";
import { Duration, Effect, Exit, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import { boardMoves } from "./board-follow.js";
import { LiveBroken, type LiveClient } from "./live-follow.js";

/**
 * A task's board followed over Realtime answers its rows on the first
 * delivery and on each that moved its mark, none for a delivery that left
 * it where it stood, and fails on a row that does not decode.
 */

const TASK = "0b3c8a40-4b8e-4a5e-9f7a-2d1c3b4a5e6f";

const SEALED: TaskBoardLiveAnswer = {
  url: "wss://realtime.example/v1",
  queries: { board: { capability: "board-0", queryFingerprint: "board", expiresAt: 3_600_000 } },
};

/** Realtime as a script: the board's one subscription, which a test delivers rows to. */
function fakeRealtime() {
  let listener:
    | ((snapshot: {
        readonly status: string;
        readonly data: readonly unknown[] | undefined;
      }) => void)
    | undefined;
  const client: LiveClient = {
    subscribe: () => ({
      onChange: (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      renew: () => Promise.resolve(),
      unsubscribe: () => {
        listener = undefined;
      },
    }),
    close: () => {},
  };
  return {
    client,
    deliver: (data: readonly unknown[]) => {
      assert.ok(listener, "the board is subscribed to");
      listener({ status: "live", data });
    },
  };
}

const mark = (drawingNumber: number, appliedDrawing: number, imaged: boolean) => ({
  taskId: TASK,
  drawingNumber,
  appliedDrawing,
  imaged,
});

const follow = (realtime: ReturnType<typeof fakeRealtime>) =>
  boardMoves(
    { openLive: () => realtime.client, seal: () => Effect.succeed(SEALED), now: () => 0 },
    SEALED,
  );

it.effect("answers the first delivery and each that moved the mark, and none that did not", () =>
  Effect.gen(function* () {
    const realtime = fakeRealtime();
    const moves = yield* Effect.forkChild(follow(realtime).pipe(Stream.take(3), Stream.runCollect));
    yield* TestClock.adjust(Duration.millis(1));

    realtime.deliver([]);
    realtime.deliver([]);
    realtime.deliver([mark(1, 0, false)]);
    realtime.deliver([mark(1, 0, false)]);
    realtime.deliver([mark(1, 1, true)]);

    assert.deepEqual(yield* Fiber.join(moves), [
      { board: [] },
      { board: [mark(1, 0, false)] },
      { board: [mark(1, 1, true)] },
    ]);
  }),
);

it.effect("fails where a row does not decode", () =>
  Effect.gen(function* () {
    const realtime = fakeRealtime();
    const moves = yield* Effect.forkChild(follow(realtime).pipe(Stream.runDrain));
    yield* TestClock.adjust(Duration.millis(1));

    realtime.deliver([{ taskId: TASK, drawingNumber: "one" }]);

    assert.deepEqual(
      yield* Fiber.await(moves),
      Exit.fail(new LiveBroken({ reason: "a row did not decode" })),
    );
  }),
);
