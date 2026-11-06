import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { followStream } from "./act-stream.js";

type Stream = AsyncIteratorObject<string, unknown, unknown>;

const settle = Effect.repeat(Effect.yieldNow, { times: 20 });

async function* brokenAfter(...words: string[]): AsyncGenerator<string> {
  yield* words;
  throw new Error("port closed");
}

async function* heldAfter(...words: string[]): AsyncGenerator<string> {
  yield* words;
  await Promise.withResolvers<never>().promise;
}

function port(...streams: (Stream | undefined)[]) {
  const taken: string[] = [];
  let opens = 0;
  const open = () => {
    const stream = streams[opens];
    opens += 1;
    return stream === undefined
      ? Promise.reject(new Error("port refused"))
      : Promise.resolve(stream);
  };
  return {
    taken,
    opens: () => opens,
    follow: followStream(open, (word: string) => taken.push(word)),
  };
}

it.effect("a stream that breaks is opened again, and the words after it are taken", () =>
  Effect.gen(function* () {
    const fake = port(brokenAfter("a"), heldAfter("b", "c"));
    const fiber = yield* Effect.forkChild(fake.follow);
    yield* settle;
    assert.deepEqual(fake.taken, ["a"]);
    assert.equal(fake.opens(), 1);

    yield* TestClock.adjust("1 second");
    yield* settle;
    assert.deepEqual(fake.taken, ["a", "b", "c"]);
    assert.equal(fake.opens(), 2);
    yield* Fiber.interrupt(fiber);
  }),
);

it.effect("a stream that ends is opened again as one that broke", () =>
  Effect.gen(function* () {
    async function* ended(): AsyncGenerator<string> {
      yield "a";
    }
    const fake = port(ended(), heldAfter("b"));
    const fiber = yield* Effect.forkChild(fake.follow);
    yield* settle;
    yield* TestClock.adjust("1 second");
    yield* settle;
    assert.deepEqual(fake.taken, ["a", "b"]);
    yield* Fiber.interrupt(fiber);
  }),
);

it.effect("a stream that cannot be opened is asked again on a wait that doubles", () =>
  Effect.gen(function* () {
    const fake = port(undefined, undefined, heldAfter("a"));
    const fiber = yield* Effect.forkChild(fake.follow);
    yield* settle;
    assert.equal(fake.opens(), 1);

    yield* TestClock.adjust("1 second");
    yield* settle;
    assert.equal(fake.opens(), 2);

    yield* TestClock.adjust("1 second");
    yield* settle;
    assert.equal(fake.opens(), 2);

    yield* TestClock.adjust("1 second");
    yield* settle;
    assert.equal(fake.opens(), 3);
    assert.deepEqual(fake.taken, ["a"]);
    yield* Fiber.interrupt(fiber);
  }),
);

it.effect("a follow let go lets its stream go and opens nothing more", () =>
  Effect.gen(function* () {
    let returned = false;
    const held: Stream = {
      next: () => Promise.withResolvers<IteratorResult<string>>().promise,
      return: () => {
        returned = true;
        return Promise.resolve({ done: true, value: undefined });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
      [Symbol.asyncDispose]: () => Promise.resolve(),
    };
    const fake = port(held);
    const fiber = yield* Effect.forkChild(fake.follow);
    yield* settle;
    yield* Fiber.interrupt(fiber);
    assert.equal(returned, true);

    yield* TestClock.adjust("1 minute");
    yield* settle;
    assert.equal(fake.opens(), 1);
  }),
);

it.effect("a follow let go while its stream opens lets the stream go once it opens", () =>
  Effect.gen(function* () {
    let returned = 0;
    const late: Stream = {
      next: () => Promise.withResolvers<IteratorResult<string>>().promise,
      return: () => {
        returned += 1;
        return Promise.resolve({ done: true, value: undefined });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
      [Symbol.asyncDispose]: () => Promise.resolve(),
    };
    const opening = Promise.withResolvers<Stream>();
    let opens = 0;
    const fiber = yield* Effect.forkChild(
      followStream(
        () => {
          opens += 1;
          return opening.promise;
        },
        () => undefined,
      ),
    );
    yield* settle;
    const letGo = yield* Effect.forkChild(Fiber.interrupt(fiber));
    yield* settle;
    opening.resolve(late);
    yield* Fiber.join(letGo);
    assert.equal(returned, 1);

    yield* TestClock.adjust("1 minute");
    yield* settle;
    assert.equal(opens, 1);
  }),
);
