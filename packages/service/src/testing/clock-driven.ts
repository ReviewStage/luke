import { Clock, type Duration, Effect, Fiber, Option, Queue } from "effect";
import { TestClock } from "effect/testing";

export interface ClockDriven<A, E> {
  readonly fiber: Fiber.Fiber<A, E>;
  readonly asleep: Queue.Dequeue<void>;
}

export const announcingClock = Effect.gen(function* () {
  const clock = yield* Clock.Clock;
  const asleep = yield* Queue.unbounded<void>();
  const announcing: Clock.Clock = {
    ...clock,
    sleep: (duration) =>
      Effect.gen(function* () {
        const waiting = yield* Effect.forkChild(clock.sleep(duration), {
          startImmediately: true,
        });
        yield* Queue.offer(asleep, undefined);
        yield* Fiber.join(waiting);
      }),
  };
  return { clock: announcing, asleep: Queue.asDequeue(asleep) };
});

export const forkClockDriven = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<ClockDriven<A, E>, never, R> =>
  Effect.gen(function* () {
    const { clock, asleep } = yield* announcingClock;
    const fiber = yield* Effect.forkChild(Effect.provideService(effect, Clock.Clock, clock));
    return { fiber, asleep };
  });

export const driven = <A, E>(subject: ClockDriven<A, E>, step: Duration.Duration) =>
  Effect.gen(function* () {
    for (;;) {
      const settled = yield* Effect.raceFirst(
        Effect.map(Fiber.await(subject.fiber), Option.some),
        Effect.as(Queue.take(subject.asleep), Option.none()),
      );
      if (Option.isSome(settled)) return yield* settled.value;
      yield* TestClock.adjust(step);
    }
  });
