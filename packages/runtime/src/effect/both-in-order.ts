/**
 * both-in-order.ts -- two independent effects run at once, answering as the two run one after the other would.
 *
 * A request that makes two reads neither of which needs the other waits on
 * the slower rather than on the sum, yet still refuses as it did when they
 * ran in order: where both fail, the first's failure is the one answered,
 * whichever failed sooner, so a caller never learns which read was faster.
 * The second runs even where the first fails, so neither may write.
 */
import { Effect, Result } from "effect";

/** Both effects' values, run together, or the failure of the first of them in order that failed. */
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
