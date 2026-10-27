import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { LIVE_POLL_URL, LIVE_SIGNED_OUT, type SealedLiveQueryWire } from "@luke/features/live-wire";
import { Clock, Duration, Effect, Exit, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import { confirmWrite, LiveBroken, liveRows, type SealedRead, type TxWait } from "./live-follow.js";

/**
 * A read followed over the service's held poll hands on its first answer's
 * rows, then polls past where they stood, handing on each answer that moved;
 * a poll that fails is asked again on a backoff and says the rows may be
 * behind; a read refused as signed out ends.
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

/** A read as the service answers it polled: each part's rows inline under a digest of them, or the digest alone where nothing moved. */
function polledRead(left: readonly unknown[] | undefined, digest: string): SealedRead<Part> {
  const part = (name: Part, rows: readonly unknown[] | undefined) => ({
    ...sealed(name),
    digest: `${name}-${digest}`,
    ...(rows === undefined ? undefined : { rows }),
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

it.effect("a poll that fails is asked again a second later, then longer, up to five seconds", () =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    const asks: number[] = [];
    const following = yield* Effect.forkChild(
      liveRows<Part>(
        {
          poll: () =>
            Effect.sync(() => {
              asks.push(clock.currentTimeMillisUnsafe());
              return { failure: "unavailable" };
            }),
        },
        polledRead([], "1"),
      ).pipe(Stream.runDrain),
    );
    for (let second = 0; second < 30; second += 1) {
      yield* settled;
      yield* TestClock.adjust(Duration.seconds(1));
    }
    const start = asks[0] ?? 0;
    const gaps = asks.slice(1).map((at, index) => at - (asks[index] ?? start));
    assert.deepEqual(gaps.slice(0, 4), [1_000, 2_000, 4_000, 5_000]);
    assert.ok(gaps.every((gap) => gap <= 5_000));
    yield* Fiber.interrupt(following);
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

it.effect(
  "a write confirms at once where it changed no row, and waits for its transaction where it did",
  () =>
    Effect.gen(function* () {
      const arrived = new Set<string>();
      const wait: TxWait = (txid) =>
        Effect.repeat(Effect.sleep(Duration.millis(100)), { until: () => arrived.has(txid) });
      const unchanged = yield* Effect.forkChild(confirmWrite(wait, undefined));
      yield* settled;
      assert.ok(unchanged.pollUnsafe(), "no txid, nothing to wait for");

      const committed = yield* Effect.forkChild(confirmWrite(wait, "42"));
      yield* TestClock.adjust(Duration.seconds(1));
      assert.equal(committed.pollUnsafe(), undefined, "still waiting");
      arrived.add("42");
      yield* TestClock.adjust(Duration.seconds(1));
      assert.ok(committed.pollUnsafe(), "confirmed once it arrived");
    }),
);

it.effect("a write whose transaction never arrives is confirmed still once ten seconds pass", () =>
  Effect.gen(function* () {
    const wait: TxWait = (_txid, timeout) =>
      Effect.andThen(Effect.sleep(timeout), Effect.fail(new LiveBroken({ reason: "timed out" })));
    const committed = yield* Effect.forkChild(confirmWrite(wait, "42"));
    yield* TestClock.adjust(Duration.seconds(9));
    assert.equal(committed.pollUnsafe(), undefined, "still waiting");
    yield* TestClock.adjust(Duration.seconds(1));
    const exit = committed.pollUnsafe();
    assert.ok(exit !== undefined && Exit.isSuccess(exit), "confirmed, since it committed");
  }),
);
