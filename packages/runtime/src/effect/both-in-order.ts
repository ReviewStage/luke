import { Effect, Result } from "effect";

export function bothInOrder<A, E, R, B, E2, R2>(
  first: Effect.Effect<A, E, R>,
  second: Effect.Effect<B, E2, R2>,
): Effect.Effect<readonly [A, B], E | E2, R | R2> {
  return Effect.flatMap(
    Effect.all([Effect.result(first), Effect.result(second)], { concurrency: 2 }),
    ([one, two]): Effect.Effect<readonly [A, B], E | E2> => {
      if (Result.isFailure(one)) return Effect.fail(one.failure);
      if (Result.isFailure(two)) return Effect.fail(two.failure);
      return Effect.succeed([one.success, two.success] as const);
    },
  );
}
