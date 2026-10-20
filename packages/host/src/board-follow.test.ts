import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { LIVE_POLL_URL, type TaskBoardLiveAnswer } from "@luke/features/live-wire";
import { Duration, Effect, Exit, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import { boardMoves } from "./board-follow.js";
import { LiveBroken, type LiveClient } from "./live-follow.js";

/**
 * A task's board followed over Realtime answers its rows on the first
 * delivery and on each that moved its mark, none for a delivery that left
 * it where it stood, keeps moving through a Realtime outage by polling,
 * and fails on a row that does not decode.
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
    /** Realtime stops the board's subscription, as an outage does. */
    fail: () => listener?.({ status: "error", data: undefined }),
  };
}

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

const follow = (
  realtime: ReturnType<typeof fakeRealtime>,
  poll: () => TaskBoardLiveAnswer = () => polled([]),
) =>
  boardMoves(
    {
      openLive: () => realtime.client,
      seal: () => Effect.succeed(SEALED),
      poll: () => Effect.sync(poll),
      now: () => 0,
    },
    SEALED,
  );

it.effect("answers the first delivery and each that moved the mark, and none that did not", () =>
  Effect.gen(function* () {
    const realtime = fakeRealtime();
    const moves = yield* Effect.forkChild(follow(realtime).pipe(Stream.take(3), Stream.runCollect));
    yield* settled;

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

it.effect(
  "through a Realtime outage the board is polled every few seconds and still moves, and once Realtime delivers again the polling stops",
  () =>
    Effect.gen(function* () {
      const realtime = fakeRealtime();
      let board = [mark(1, 0, false)];
      let polls = 0;
      const moves: unknown[] = [];
      const following = yield* Effect.forkChild(
        Stream.runForEach(
          follow(realtime, () => {
            polls += 1;
            return polled(board);
          }),
          (move) => Effect.sync(() => void moves.push(move)),
        ),
      );
      yield* settled;
      realtime.deliver(board);

      realtime.fail();
      yield* settled;
      board = [mark(2, 1, true)];
      yield* TestClock.adjust(Duration.seconds(3));
      yield* settled;
      assert.ok(polls >= 1, "polled while Realtime is out");
      assert.deepEqual(moves, [{ board: [mark(1, 0, false)] }, { board: [mark(2, 1, true)] }]);

      // Realtime is subscribed to again, and its first delivery stops the polling.
      yield* TestClock.adjust(Duration.seconds(15));
      yield* settled;
      realtime.deliver([mark(3, 2, true)]);
      yield* settled;
      const settledPolls = polls;
      yield* TestClock.adjust(Duration.seconds(30));
      yield* settled;
      assert.equal(polls, settledPolls, "no polling once Realtime is back");
      assert.deepEqual(moves.at(-1), { board: [mark(3, 2, true)] });
      yield* Fiber.interrupt(following);
    }),
);

it.effect("fails where a row does not decode", () =>
  Effect.gen(function* () {
    const realtime = fakeRealtime();
    const moves = yield* Effect.forkChild(follow(realtime).pipe(Stream.runDrain));
    yield* settled;

    realtime.deliver([{ taskId: TASK, drawingNumber: "one" }]);

    assert.deepEqual(
      yield* Fiber.await(moves),
      Exit.fail(new LiveBroken({ reason: "a row did not decode" })),
    );
  }),
);
