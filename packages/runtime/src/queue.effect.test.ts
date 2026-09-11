import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Chunk, Duration, Effect, Exit, Schedule, Scope, TestClock } from "effect";
import {
  admitInput,
  makePendingInputQueue,
  QUEUE_REFUSAL,
  QUEUE_WITHDRAWAL_REFUSAL,
  queueDebounceSchedule,
} from "./queue.effect.js";
import {
  DEFAULT_QUEUE_SETTINGS,
  EMPTY_QUEUE,
  type PendingQueueState,
  QUEUE_MODE,
  QUEUE_OVERFLOW,
  type QueueBatch,
  type QueuedInput,
} from "./queue.js";

const input = (id: string): QueuedInput => ({ id, text: `words ${id}`, atMs: 1 });

const fill = (count: number): PendingQueueState => {
  let state = EMPTY_QUEUE;
  for (let index = 0; index < count; index += 1) {
    state = { ...state, entries: [...state.entries, input(`filler-${index}`)] };
  }
  return state;
};

describe("admitInput", () => {
  it.effect("answers the admission with the input queued", () =>
    Effect.gen(function* () {
      const admission = yield* admitInput(EMPTY_QUEUE, input("a"));

      assert.deepEqual(
        admission.state.entries.map((entry) => entry.id),
        ["a"],
      );
      assert.deepEqual(admission.evicted, []);
    }),
  );

  it.effect("refuses a second input of the same id as a duplicate", () =>
    Effect.gen(function* () {
      const once = yield* admitInput(EMPTY_QUEUE, input("a"));
      const refusal = yield* Effect.flip(admitInput(once.state, input("a")));

      assert.equal(refusal._tag, "QueueAdmissionRefused");
      assert.equal(refusal.code, QUEUE_REFUSAL.DUPLICATE);
      assert.equal(refusal.input.id, "a");
    }),
  );

  it.effect("refuses the newest input as overflow where the policy drops it", () =>
    Effect.gen(function* () {
      const settings = {
        capacity: 2,
        overflow: QUEUE_OVERFLOW.DROP_NEWEST,
      } as const;
      const refusal = yield* Effect.flip(admitInput(fill(2), input("late"), settings));

      assert.equal(refusal.code, QUEUE_REFUSAL.OVERFLOW);
      assert.equal(refusal.input.id, "late");
    }),
  );

  it.effect("keeps the fold's eviction on the admission that summarized it", () =>
    Effect.gen(function* () {
      const settings = { capacity: 2, overflow: QUEUE_OVERFLOW.SUMMARIZE } as const;
      const admission = yield* admitInput(fill(2), input("late"), settings);

      assert.deepEqual(
        admission.evicted.map((entry) => entry.id),
        ["filler-0"],
      );
      assert.equal(admission.state.summarizedCount, 1);
    }),
  );
});

describe("queueDebounceSchedule", () => {
  it.effect("states the debounce window as its first delay", () =>
    Effect.gen(function* () {
      const delays = yield* Schedule.run(queueDebounceSchedule(), 0, [undefined]);

      assert.deepEqual(Chunk.toReadonlyArray(delays).map(Duration.toMillis), [
        DEFAULT_QUEUE_SETTINGS.debounceMs,
      ]);
    }),
  );
});

describe("makePendingInputQueue", () => {
  const openQueue = Effect.gen(function* () {
    const batches: QueueBatch[][] = [];
    const queue = yield* makePendingInputQueue({
      steer: () => false,
      interrupt: () => {},
      flush: (drained) => batches.push([...drained]),
    });
    return { queue, batches };
  });

  it.effect("drains on the debounce window and not before", () =>
    Effect.gen(function* () {
      const { queue, batches } = yield* Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* openQueue;
          yield* opened.queue.push(input("a"));
          yield* opened.queue.push(input("b"));

          yield* TestClock.adjust(Duration.millis(DEFAULT_QUEUE_SETTINGS.debounceMs - 1));
          assert.deepEqual(opened.batches, []);

          yield* TestClock.adjust(Duration.millis(1));
          return opened;
        }),
      );

      assert.equal(batches.length, 1);
      assert.deepEqual(
        batches[0]?.flatMap((batch) => batch.inputs.map((entry) => entry.id)),
        ["a", "b"],
      );
      assert.equal(yield* queue.size, 0);
    }),
  );

  it.effect("opens one turn per input under the follow-up mode", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { queue, batches } = yield* openQueue;
        yield* queue.push(input("a"), QUEUE_MODE.FOLLOWUP);
        yield* queue.push(input("b"), QUEUE_MODE.FOLLOWUP);

        yield* queue.flush(QUEUE_MODE.FOLLOWUP);

        assert.deepEqual(
          batches[0]?.map((batch) => batch.inputs.map((entry) => entry.id)),
          [["a"], ["b"]],
        );
      }),
    ),
  );

  it.effect("refuses a duplicate push with the duplicate code", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { queue } = yield* openQueue;
        yield* queue.push(input("a"));

        const refusal = yield* Effect.flip(queue.push(input("a")));

        assert.equal(refusal.code, QUEUE_REFUSAL.DUPLICATE);
        assert.equal(yield* queue.size, 1);
      }),
    ),
  );

  it.effect("takes back a queued input and refuses one it never held", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { queue } = yield* openQueue;
        yield* queue.push(input("a"));

        yield* queue.withdraw("a");
        const refusal = yield* Effect.flip(queue.withdraw("a"));

        assert.equal(refusal.code, QUEUE_WITHDRAWAL_REFUSAL.NOT_QUEUED);
        assert.equal(yield* queue.size, 0);
      }),
    ),
  );

  it.effect("refuses a summarized withdrawal that names no fold", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { queue } = yield* openQueue;

        const refusal = yield* Effect.flip(queue.withdrawSummarized(0));

        assert.equal(refusal.code, QUEUE_WITHDRAWAL_REFUSAL.NOT_SUMMARIZED);
      }),
    ),
  );

  it.effect("drains nothing after its scope closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const { queue, batches } = yield* Scope.extend(openQueue, scope);
      yield* queue.push(input("a"));

      yield* Scope.close(scope, Exit.void);
      yield* TestClock.adjust(Duration.millis(DEFAULT_QUEUE_SETTINGS.debounceMs * 4));

      assert.deepEqual(batches, []);
    }),
  );
});
