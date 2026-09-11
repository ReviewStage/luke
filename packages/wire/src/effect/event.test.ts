import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import {
  Chunk,
  Deferred,
  Effect,
  Exit,
  Fiber,
  type Layer,
  Logger,
  LogLevel,
  Queue,
  Scope,
  Stream,
} from "effect";
import { Emitter, type Event } from "../event.js";
import { eventFromStream, streamFromEvent } from "./event.js";

/**
 * The round's failures reach the logger rather than the fire's caller, so a
 * test that wants to see them counted has to be the logger.
 */
const counting = (levels: LogLevel.LogLevel[]): Layer.Layer<never> =>
  Logger.replace(
    Logger.defaultLogger,
    Logger.make(({ logLevel }) => {
      levels.push(logLevel);
    }),
  );

/**
 * A stream subscribes from the fiber that runs it, so a value fired before
 * that fiber has reached the subscription is fired into nothing. Waiting on
 * the subscription itself is what makes the tests below decide what they
 * claim to rather than how the scheduler happened to interleave.
 */
const awaitable = <T>(
  event: Event<T>,
): Effect.Effect<{ readonly event: Event<T>; readonly subscribed: Effect.Effect<void> }> =>
  Effect.map(Deferred.make<void>(), (latch) => ({
    subscribed: Deferred.await(latch),
    event: (listener) => {
      const subscription = event(listener);
      Deferred.unsafeDone(latch, Exit.void);
      return subscription;
    },
  }));

describe("streamFromEvent", () => {
  it.effect("carries the values fired while the stream runs, in the order they were fired", () =>
    Effect.gen(function* () {
      const emitter = new Emitter<number>();
      const source = yield* awaitable(emitter.event);
      const collected = yield* Effect.fork(
        Stream.runCollect(Stream.take(streamFromEvent(source.event), 3)),
      );
      yield* source.subscribed;

      emitter.fire(1);
      emitter.fire(2);
      emitter.fire(3);

      assert.deepEqual(Chunk.toReadonlyArray(yield* Fiber.join(collected)), [1, 2, 3]);
    }),
  );

  it.effect("drops none of a synchronous burst", () =>
    Effect.gen(function* () {
      const emitter = new Emitter<number>();
      const burst = Array.from({ length: 1_000 }, (_value, index) => index);
      const source = yield* awaitable(emitter.event);
      const collected = yield* Effect.fork(
        Stream.runCollect(Stream.take(streamFromEvent(source.event), burst.length)),
      );
      yield* source.subscribed;

      for (const value of burst) emitter.fire(value);

      assert.deepEqual(Chunk.toReadonlyArray(yield* Fiber.join(collected)), burst);
    }),
  );

  it.effect("subscribes when the stream's scope opens and unsubscribes when it closes", () =>
    Effect.gen(function* () {
      const emitter = new Emitter<number>();
      let standing = 0;
      const source = yield* awaitable<number>((listener) => {
        standing += 1;
        const subscription = emitter.event(listener);
        return {
          dispose: () => {
            standing -= 1;
            subscription.dispose();
          },
        };
      });
      const running = yield* Effect.fork(
        Stream.runDrain(Stream.take(streamFromEvent(source.event), 1)),
      );
      yield* source.subscribed;
      assert.equal(standing, 1);

      emitter.fire(1);
      yield* Fiber.join(running);

      assert.equal(standing, 0);
    }),
  );

  it.effect("delivers nothing fired before the stream ran", () =>
    Effect.gen(function* () {
      const emitter = new Emitter<number>();
      emitter.fire(1);
      const source = yield* awaitable(emitter.event);
      const collected = yield* Effect.fork(
        Stream.runCollect(Stream.take(streamFromEvent(source.event), 1)),
      );
      yield* source.subscribed;

      emitter.fire(2);

      assert.deepEqual(Chunk.toReadonlyArray(yield* Fiber.join(collected)), [2]);
    }),
  );
});

/**
 * A round of delivery is the whole of what the pump does between two of its
 * own suspensions, so a sentinel listener offering into a queue settles the
 * round however many listeners stand and wherever it subscribed among them.
 */
const rounds = <T>(
  event: Event<T>,
): Effect.Effect<{ readonly delivered: (count: number) => Effect.Effect<void> }> =>
  Effect.map(Queue.unbounded<void>(), (queue) => {
    event(() => {
      Queue.unsafeOffer(queue, undefined);
    });
    return { delivered: (count) => Effect.asVoid(Queue.takeN(queue, count)) };
  });

describe("eventFromStream", () => {
  it.effect("delivers each value to every listener, in the order they subscribed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<number>();
        const event = yield* eventFromStream(Stream.fromQueue(queue));
        const order: string[] = [];
        event((value) => order.push(`first:${value}`));
        event((value) => order.push(`second:${value}`));
        const round = yield* rounds(event);

        yield* Queue.offerAll(queue, [1, 2]);
        yield* round.delivered(2);

        assert.deepEqual(order, ["first:1", "second:1", "first:2", "second:2"]);
      }),
    ),
  );

  it.effect("hears a listener subscribed during a delivery only from the next value", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<number>();
        const event = yield* eventFromStream(Stream.fromQueue(queue));
        const late: number[] = [];
        event(() => {
          event((value) => late.push(value));
        });
        const round = yield* rounds(event);

        yield* Queue.offer(queue, 1);
        yield* round.delivered(1);
        assert.deepEqual(late, []);

        yield* Queue.offer(queue, 2);
        yield* round.delivered(1);
        assert.deepEqual(late, [2]);
      }),
    ),
  );

  it.effect("lets a thrower stop neither the rest of the round nor the next value", () =>
    Effect.gen(function* () {
      const logged: LogLevel.LogLevel[] = [];
      yield* Effect.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const queue = yield* Queue.unbounded<number>();
            const event = yield* eventFromStream(Stream.fromQueue(queue));
            const heard: number[] = [];
            event(() => {
              throw new Error("first failed");
            });
            event((value) => heard.push(value));
            const round = yield* rounds(event);

            yield* Queue.offerAll(queue, [1, 2]);
            yield* round.delivered(2);

            assert.deepEqual(heard, [1, 2]);
          }),
        ),
        counting(logged),
      );

      assert.deepEqual(logged, [LogLevel.Error, LogLevel.Error]);
    }),
  );

  it.effect("ends its listener's subscription without ending anyone else's", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<number>();
        const event = yield* eventFromStream(Stream.fromQueue(queue));
        const kept: number[] = [];
        const ended: number[] = [];
        event((value) => kept.push(value));
        const subscription = event((value) => ended.push(value));
        const round = yield* rounds(event);

        yield* Queue.offer(queue, 1);
        yield* round.delivered(1);
        subscription.dispose();
        yield* Queue.offer(queue, 2);
        yield* round.delivered(1);

        assert.deepEqual(kept, [1, 2]);
        assert.deepEqual(ended, [1]);
      }),
    ),
  );

  it.effect("delivers nothing once its scope has closed", () =>
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<number>();
      const scope = yield* Scope.make();
      const event = yield* Scope.extend(eventFromStream(Stream.fromQueue(queue)), scope);
      const heard: number[] = [];
      event((value) => heard.push(value));
      const round = yield* rounds(event);

      yield* Queue.offer(queue, 1);
      yield* round.delivered(1);
      yield* Scope.close(scope, Exit.void);
      yield* Queue.offer(queue, 2);

      assert.deepEqual(heard, [1]);
    }),
  );
});
