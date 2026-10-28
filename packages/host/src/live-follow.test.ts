import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { LIVE_POLL_URL, LIVE_SIGNED_OUT, type SealedLiveQueryWire } from "@luke/features/live-wire";
import { Clock, Duration, Effect, Exit, Fiber, Random, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";
import {
  confirmWrite,
  decodedLiveRows,
  liveRows,
  type SealedRead,
  type TxWait,
} from "./live-follow.js";
import { polledLive } from "./testing/polled-live.js";

/**
 * A read followed over the service's held poll hands on its first answer's
 * rows, then polls past where they stood, handing on each answer that moved;
 * a poll that fails is asked again on a jittered backoff and says the rows
 * may be behind; a read refused as signed out ends. Once an answer carries
 * the txids of the writes that woke it, the read hands a wait a write is
 * confirmed on.
 */

/** Every step the read has to take, taken. */
const settled = Effect.repeat(
  Effect.andThen(
    Effect.yieldNow,
    Effect.promise(() => Promise.resolve()),
  ),
  { times: 20 },
);

type Part = "left" | "right";

/** A part as the service answers it polled, named by its part. */
function sealed(part: Part): SealedLiveQueryWire {
  return { capability: LIVE_POLL_URL, queryFingerprint: `fingerprint-${part}`, expiresAt: 0 };
}

/** A read as the service answers it polled: each part's rows inline under a digest of them, or the digest alone where nothing moved, and the txids of the writes that woke it where any did. */
function polledRead(
  left: readonly unknown[] | undefined,
  digest: string,
  txids?: readonly string[],
): SealedRead<Part> {
  const part = (name: Part, rows: readonly unknown[] | undefined) => ({
    ...sealed(name),
    digest: `${name}-${digest}`,
    ...(rows === undefined ? undefined : { rows }),
    ...(txids === undefined ? undefined : { txids }),
  });
  return {
    url: LIVE_POLL_URL,
    queries: {
      left: part("left", left),
      right: part("right", left === undefined ? undefined : []),
    },
  };
}

it.effect(
  "a read answered polled hands on its first rows, then polls past where they stood, handing on each answer that moved and none that did not",
  () =>
    Effect.gen(function* () {
      const asked: (string | undefined)[] = [];
      const answers = [polledRead([{ id: "b" }], "2"), polledRead(undefined, "2")];
      const rows: unknown[] = [];
      const following = yield* Effect.forkChild(
        Stream.runForEach(
          liveRows<Part>(
            {
              poll: (after) =>
                Effect.sync(() => {
                  asked.push(after);
                  return answers.shift() ?? polledRead(undefined, "2");
                }),
            },
            polledRead([{ id: "a" }], "1"),
          ),
          (whole) => Effect.sync(() => void rows.push(whole)),
        ),
      );
      yield* settled;
      yield* TestClock.adjust(Duration.seconds(1));
      yield* settled;
      assert.deepEqual(rows, [
        { left: [{ id: "a" }], right: [] },
        { left: [{ id: "b" }], right: [] },
      ]);
      assert.deepEqual(asked.slice(0, 3), ["left-1,right-1", "left-2,right-2", "left-2,right-2"]);
      yield* Fiber.interrupt(following);
    }),
);

/** A read whose `left` part the reader follows by cursor: its rows past `past`, or whole where none is named, and the cursor to read past next; its `right` part as a snapshot's. */
function cursorRead(
  left: readonly unknown[] | undefined,
  cursor: { readonly past?: string; readonly next: string },
): SealedRead<Part> {
  return {
    url: LIVE_POLL_URL,
    queries: {
      left: { ...sealed("left"), cursor, ...(left === undefined ? undefined : { rows: left }) },
      right: {
        ...sealed("right"),
        digest: "right",
        ...(left === undefined ? undefined : { rows: [] }),
      },
    },
  };
}

const IdRows = Schema.Array(Schema.Struct({ id: Schema.String }));

it.effect(
  "a read followed by cursor polls past the cursor its last answer named, joins an answer past it onto the rows held, and takes one past no cursor whole",
  () =>
    Effect.gen(function* () {
      const asked: (string | undefined)[] = [];
      const answers = [
        cursorRead([{ id: "b" }], { past: "1", next: "2" }),
        cursorRead([{ id: "c" }], { next: "3" }),
      ];
      const rows: unknown[] = [];
      const following = yield* Effect.forkChild(
        Stream.runForEach(
          decodedLiveRows<
            Part,
            { readonly left: typeof IdRows.Type; readonly right: typeof IdRows.Type }
          >(
            {
              poll: (_after, cursor) =>
                Effect.sync(() => {
                  asked.push(cursor);
                  return answers.shift() ?? cursorRead(undefined, { past: "3", next: "3" });
                }),
            },
            cursorRead([{ id: "a" }], { past: "0", next: "1" }),
            Schema.Struct({ left: IdRows, right: IdRows }),
            (held, past) => ({ ...past, left: [...held.left, ...past.left] }),
          ),
          (whole) => Effect.sync(() => void rows.push(whole)),
        ),
      );
      yield* settled;
      yield* TestClock.adjust(Duration.seconds(1));
      yield* settled;
      assert.deepEqual(rows, [
        { left: [{ id: "a" }], right: [] },
        { left: [{ id: "a" }, { id: "b" }], right: [] },
        { left: [{ id: "c" }], right: [] },
      ]);
      assert.deepEqual(asked.slice(0, 3), ["1", "2", "3"]);
      yield* Fiber.interrupt(following);
    }),
);

/** When each poll was asked, by the test's clock, for a read whose polls answer as `answer` says, moved along in steps for `span`. */
const askedAt = (
  answer: (asked: number) => ReturnType<LiveFollowPoll>,
  span: Duration.Duration,
  step: Duration.Duration,
) =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    const asks: number[] = [];
    const following = yield* Effect.forkChild(
      liveRows<Part>(
        {
          poll: () =>
            Effect.suspend(() => {
              asks.push(clock.currentTimeMillisUnsafe());
              return answer(asks.length);
            }),
        },
        polledRead([], "1"),
      ).pipe(Stream.runDrain),
    );
    for (let at = 0; at < Duration.toMillis(span); at += Duration.toMillis(step)) {
      yield* settled;
      yield* TestClock.adjust(step);
    }
    yield* Fiber.interrupt(following);
    return asks;
  });

type LiveFollowPoll = Parameters<typeof liveRows<Part>>[0]["poll"];

/** The time between each ask and the one before it. */
const gapsOf = (asks: readonly number[]) =>
  asks.slice(1).map((at, index) => at - (asks[index] ?? 0));

it.effect(
  "a poll that fails is asked again after a wait drawn at random up to a second, then up to two, four, and five",
  () =>
    Effect.gen(function* () {
      const asks = yield* askedAt(
        () => Effect.succeed({ failure: "unavailable" }),
        Duration.seconds(15),
        Duration.millis(100),
      ).pipe(
        // Every wait drawn at half its bound, so the bounds read back doubled.
        Effect.provideService(Random.Random, {
          nextIntUnsafe: () => 0,
          nextDoubleUnsafe: () => 0.5,
        }),
      );
      assert.deepEqual(gapsOf(asks).slice(0, 5), [500, 1_000, 2_000, 2_500, 2_500]);
    }),
);

it.effect(
  "a poll goes a coalesce window after an answer a write woke, and the floor after any other",
  () =>
    Effect.gen(function* () {
      const asks = yield* askedAt(
        (asked) =>
          Effect.succeed(
            asked === 1 ? polledRead([{ id: "b" }], "2", ["41"]) : polledRead(undefined, "2"),
          ),
        Duration.seconds(1),
        Duration.millis(50),
      );
      assert.deepEqual(gapsOf(asks).slice(0, 2), [100, 500]);
    }),
);

it.effect(
  "a poll that fails says the rows may be behind, and the next poll that answers hands its rows on again, moved or not",
  () =>
    Effect.gen(function* () {
      let failing = false;
      let behind = 0;
      const rows: unknown[] = [];
      const following = yield* Effect.forkChild(
        Stream.runForEach(
          liveRows<Part>(
            {
              // A poll past a digest answers it unchanged with no rows, as the held poll does; one past none answers the rows whole.
              poll: (after) =>
                Effect.succeed(
                  failing
                    ? { failure: "unavailable" }
                    : polledRead(after === undefined ? [] : undefined, "1"),
                ),
              behind: () => {
                behind += 1;
              },
            },
            polledRead([], "1"),
          ),
          (whole) => Effect.sync(() => void rows.push(whole)),
        ),
      );
      yield* settled;
      yield* TestClock.adjust(Duration.seconds(1));
      yield* settled;
      assert.equal(rows.length, 1, "rows that did not move are handed on once");
      assert.equal(behind, 0);

      failing = true;
      yield* TestClock.adjust(Duration.seconds(1));
      yield* settled;
      assert.ok(behind > 0, "the failed poll says the rows may be behind");
      assert.equal(rows.length, 1);

      failing = false;
      yield* TestClock.adjust(Duration.seconds(5));
      yield* settled;
      assert.equal(rows.length, 2, "the poll that answers hands the same rows on again");
      assert.deepEqual(rows[1], rows[0]);
      yield* Fiber.interrupt(following);
    }),
);

it.effect("a read whose session the service refuses as signed out ends, and is asked no more", () =>
  Effect.gen(function* () {
    const exit = yield* liveRows<Part>(
      { poll: () => Effect.succeed(LIVE_SIGNED_OUT) },
      polledRead([], "0"),
    ).pipe(Stream.runDrain, Effect.exit);
    assert.ok(Exit.isFailure(exit));
  }),
);

/** A read followed over a scripted held poll, and the wait it hands, as it stands. */
const followedWithWait = Effect.gen(function* () {
  const live = polledLive<Part>(["left", "right"]);
  let handed: TxWait | undefined;
  const following = yield* Effect.forkChild(
    Stream.runDrain(
      liveRows<Part>(
        {
          poll: live.poll,
          onTxWait: (wait) => {
            handed = wait;
          },
        },
        live.first(),
      ),
    ),
  );
  yield* settled;
  return { live, following, wait: () => handed };
});

/** Whether the fiber has ended, and ended well. */
const succeeded = <A, E>(fiber: Fiber.Fiber<A, E>) => {
  const exit = fiber.pollUnsafe();
  return exit !== undefined && Exit.isSuccess(exit);
};

it.effect(
  "a write waits for the first answer carrying its txid, once an answer carried any, and a write that changed no row waits for none",
  () =>
    Effect.gen(function* () {
      const { live, following, wait } = yield* followedWithWait;
      live.set({ left: [{ id: "a" }], right: [] });
      yield* TestClock.adjust(Duration.seconds(1));
      yield* settled;
      assert.equal(wait(), undefined, "no answer carried a txid, so no wait is handed");

      live.set({ left: [{ id: "b" }] }, ["41"]);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* settled;
      const unchanged = yield* Effect.forkChild(confirmWrite(wait(), undefined));
      const committed = yield* Effect.forkChild(confirmWrite(wait(), "42"));
      yield* settled;
      assert.ok(succeeded(unchanged), "no txid, nothing to wait for");
      yield* TestClock.adjust(Duration.seconds(1));
      assert.equal(committed.pollUnsafe(), undefined, "still waiting");

      live.set({ left: [{ id: "c" }] }, ["42"]);
      yield* settled;
      assert.ok(succeeded(committed), "confirmed on the answer carrying it");

      yield* Fiber.interrupt(following);
      assert.equal(wait(), undefined, "the wait is taken back once the read is let go");
    }),
);

it.effect("a write whose txid an answer already carried confirms at once", () =>
  Effect.gen(function* () {
    const { live, wait } = yield* followedWithWait;
    live.set({ left: [{ id: "a" }], right: [] }, ["42"]);
    yield* settled;

    const committed = yield* Effect.forkChild(confirmWrite(wait(), "42"));
    yield* settled;
    assert.ok(succeeded(committed));
  }),
);

it.effect("a write whose txid no answer carries is confirmed still once ten seconds pass", () =>
  Effect.gen(function* () {
    const { live, wait } = yield* followedWithWait;
    live.set({ left: [{ id: "a" }], right: [] }, ["41"]);
    yield* settled;

    const committed = yield* Effect.forkChild(confirmWrite(wait(), "42"));
    yield* TestClock.adjust(Duration.seconds(9));
    assert.equal(committed.pollUnsafe(), undefined, "still waiting");
    yield* TestClock.adjust(Duration.seconds(1));
    assert.ok(succeeded(committed), "confirmed, since it committed");
  }),
);
