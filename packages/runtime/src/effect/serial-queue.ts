import { Cause, Effect, Queue, type Scope } from "effect";

export type SerialWork<R = never> = Effect.Effect<void, never, R>;

export interface SerialQueueOptions {
  readonly onDefect: (cause: Cause.Cause<never>) => Effect.Effect<void>;
  readonly drainOnClose?: boolean;
}

export interface SerialQueue<R = never> {
  readonly offer: (work: SerialWork<R>) => Effect.Effect<void>;
  readonly offerUnsafe: (work: SerialWork<R>) => void;
}

export const serialQueue = /* @__PURE__ */ Effect.fnUntraced(function* <R = never>(
  options: SerialQueueOptions,
): Effect.fn.Return<SerialQueue<R>, never, Scope.Scope | R> {
  const queue = yield* Queue.unbounded<SerialWork<R>>();
  const take = (work: SerialWork<R>): SerialWork<R> =>
    Effect.catchDefect(work, (defect) => options.onDefect(Cause.die(defect)));
  if (options.drainOnClose) {
    yield* Effect.addFinalizer(() =>
      Effect.flatMap(Queue.clear(queue), (pending) =>
        Effect.forEach(pending, take, { discard: true }),
      ),
    );
  }
  yield* Effect.forkScoped(Effect.forever(Effect.flatMap(Queue.take(queue), take)));
  return {
    offer: (work) => Effect.asVoid(Queue.offer(queue, work)),
    offerUnsafe: (work) => {
      Queue.offerUnsafe(queue, work);
    },
  };
});
