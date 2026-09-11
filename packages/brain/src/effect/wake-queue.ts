/**
 * The wake queue's own storage, in Effect's own terms. `../wake-queue.ts`'s
 * `WakeQueue` keeps every rule about what waits for a turn — the same
 * observation delivered twice is one entry, past the capacity the oldest
 * goes, a requeue puts events back at the front unbounded because they are
 * still news — and this module is where that storage lives as an Effect
 * `Queue`: `Queue.unbounded` because a requeue must never be trimmed, with
 * the capacity rule applied as this module's own fold on `push` rather than
 * the queue's, since a `Queue.sliding` would apply it to every offer alike.
 * `take` drains what stands now through a `Stream` bounded to the size read
 * a moment before, rather than `Queue.takeAll`, so the drain is stated in the
 * vocabulary the rest of the migration reads rather than a queue-specific
 * escape hatch; a `Stream` pulling from an empty queue forever is exactly
 * what the size bound rules out.
 *
 * Every operation here is one that never suspends — an unbounded queue's
 * offer always succeeds at once, and a stream bounded to a size already read
 * never waits for a next element — so `../wake-queue.ts`'s synchronous
 * methods can run each one with `Effect.runSync` and stay exactly the
 * synchronous facade they were. That bridge is the strangler shim
 * `docs/adr/0001-effect.md` names; P5-14b deletes it once the turn runner and
 * its callers hold a fiber of their own instead of this class.
 */
import { Chunk, Effect, Queue, Stream } from "effect";
import { sameObservation } from "../observation-inbox.js";
import type { BrainWakeEvent } from "../wake-events.js";

export interface WakeEventQueue {
  readonly size: Effect.Effect<number>;
  /** Dedups against what stands and against the batch itself, then trims to the capacity from the front. */
  readonly push: (events: readonly BrainWakeEvent[]) => Effect.Effect<void>;
  /** Drains everything that stands now, in order; the queue is empty after. */
  readonly take: Effect.Effect<readonly BrainWakeEvent[]>;
  /** Prepends events ahead of what stands, with no capacity trim. */
  readonly requeueFront: (events: readonly BrainWakeEvent[]) => Effect.Effect<void>;
  readonly clear: Effect.Effect<void>;
}

const drain = (queue: Queue.Queue<BrainWakeEvent>): Effect.Effect<readonly BrainWakeEvent[]> =>
  Effect.gen(function* () {
    const size = yield* Queue.size(queue);
    if (size === 0) return [];
    const drained = yield* Stream.fromQueue(queue).pipe(Stream.take(size), Stream.runCollect);
    return Chunk.toReadonlyArray(drained);
  });

const refill = (
  queue: Queue.Queue<BrainWakeEvent>,
  events: readonly BrainWakeEvent[],
): Effect.Effect<void> => (events.length === 0 ? Effect.void : Queue.offerAll(queue, events));

/** The wake queue's own storage, backed by an unbounded Effect `Queue`. */
export const makeWakeEventQueue = (capacity: number): Effect.Effect<WakeEventQueue> =>
  Effect.map(Queue.unbounded<BrainWakeEvent>(), (queue) => ({
    size: Queue.size(queue),
    push: (events) =>
      events.length === 0
        ? Effect.void
        : Effect.gen(function* () {
            const held = Chunk.toReadonlyArray(yield* Queue.takeAll(queue)).slice();
            for (const event of events) {
              if (!held.some((entry) => sameObservation(entry, event))) held.push(event);
            }
            const trimmed = held.length > capacity ? held.slice(held.length - capacity) : held;
            yield* refill(queue, trimmed);
          }),
    take: drain(queue),
    requeueFront: (events) =>
      events.length === 0
        ? Effect.void
        : Effect.gen(function* () {
            const held = yield* Queue.takeAll(queue);
            yield* refill(queue, [...events, ...Chunk.toReadonlyArray(held)]);
          }),
    clear: Effect.asVoid(Queue.takeAll(queue)),
  }));
