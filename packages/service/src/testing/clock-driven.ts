/**
 * clock-driven.ts -- a forked effect that polls a real database on the TestClock, driven to its end one wait at a time.
 */

import { Clock, type Duration, Effect, Fiber, Option, Queue } from "effect";
import { TestClock } from "effect/testing";

/**
 * A store test forks the effect under test, plays the Mac's half against the
 * database, and then moves the TestClock until the effect answers. The clock
 * may move only while the effect is asleep on it: a statement to a real
 * Postgres takes real milliseconds that the TestClock does not count, so a
 * clock moved at the test's own pace runs out the effect's deadline while
 * its next read is still in flight, and the effect answers that nothing came
 * when the row it waited for had landed. So the effect is forked on a clock
 * that announces each wait once the TestClock holds it, and the test moves
 * the clock one step per announcement, never ahead of a wait it was asked
 * for.
 */
export interface ClockDriven<A, E> {
  readonly fiber: Fiber.Fiber<A, E>;
  readonly asleep: Queue.Dequeue<void>;
}

/**
 * The effect forked on the test's clock, with each wait it makes announced.
 * Note that the wait is forked to start at once, because the TestClock
 * registers it synchronously, so a wait is held before it is announced and
 * the step that answers the announcement wakes it.
 */
export const forkClockDriven = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<ClockDriven<A, E>, never, R> =>
  Effect.gen(function* () {
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
    const fiber = yield* Effect.forkChild(Effect.provideService(effect, Clock.Clock, announcing));
    return { fiber, asleep };
  });

/** The forked effect driven to its end, the clock moved one step each time it falls asleep. */
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
