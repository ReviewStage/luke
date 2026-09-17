/**
 * serial-queue.ts -- one fiber taking offered work in order, for the scope it was made in.
 *
 * What a synchronous edge or a caller that waits for nothing hands on: each
 * piece of work is taken in turn by one fiber forked into the scope the queue
 * was made in, in the order it was offered, and one that dies is handed to
 * `onDefect` rather than left to end the fiber every later piece needs. An
 * interruption is the scope closing and is not caught, so the fiber ends
 * with the scope rather than looping past its own end. `offerUnsafe` is the
 * door from a callback that belongs to no fiber; `offer` is the same door
 * from inside one.
 */
import { Cause, Effect, Queue, type Scope } from "effect";

/** Work the queue takes: it fails with nothing, since what it could fail with is its own to answer. */
export type SerialWork<R = never> = Effect.Effect<void, never, R>;

export interface SerialQueueOptions {
  /** What a piece of work that died is handed to, the fiber going on to the next. */
  readonly onDefect: (cause: Cause.Cause<never>) => Effect.Effect<void>;
  /**
   * Whether what was offered and not yet taken when the scope closes is run
   * then, after the fiber has been interrupted, rather than lost with the
   * queue; a piece run this way runs inside a finalizer, uninterruptibly.
   */
  readonly drainOnClose?: boolean;
}

export interface SerialQueue<R = never> {
  /** Puts work at the back of the line, from inside a fiber. */
  readonly offer: (work: SerialWork<R>) => Effect.Effect<void>;
  /** Puts work at the back of the line, from a synchronous callback with no fiber of its own. */
  readonly offerUnsafe: (work: SerialWork<R>) => void;
}

/**
 * The queue and its fiber, standing for the scope this runs in. `R` is what
 * the work may need, provided once here by the context the fiber is forked
 * from rather than by each caller that offers.
 */
export const serialQueue = /* @__PURE__ */ Effect.fnUntraced(function* <R = never>(
  options: SerialQueueOptions,
): Effect.fn.Return<SerialQueue<R>, never, Scope.Scope | R> {
  const queue = yield* Queue.unbounded<SerialWork<R>>();
  const take = (work: SerialWork<R>): SerialWork<R> =>
    Effect.catchDefect(work, (defect) => options.onDefect(Cause.die(defect)));
  // Registered before the fork so the close runs it after the fiber has been
  // interrupted. `Queue.clear` is what reads a queue that may be empty:
  // `Queue.takeAll` waits for a first message, and a finalizer is
  // uninterruptible, so a close behind an empty queue would never end.
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
