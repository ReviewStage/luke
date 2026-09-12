import { Deferred, Effect, FiberId } from "effect";

/**
 * Collapses concurrent asks for a refresh into one in-flight run, and every
 * caller awaits that run's outcome. The refresh token rotates when spent, so
 * two refreshes racing — a hosted mint and a review both answering 401 at the
 * hour mark — would have the loser spend an already-rotated token, and the
 * token endpoint's `invalid_grant` for it reads as revocation: a sign-out
 * right after a successful refresh. A run that ends, ends the flight; the next
 * ask starts a fresh one holding the newly rotated token.
 *
 * The run itself starts synchronously the instant the returned closure is
 * called, before the Effect it hands back is ever run: the semaphore guards a
 * body that cannot suspend, so the check-and-create of the one {@link Deferred}
 * every concurrent caller then joins is one uninterruptible step regardless of
 * when — or whether — a caller runs the await that follows. That is the whole
 * of what `Effect.runSync` is for here, and it is why this file is on the
 * `Effect.runPromise` allowlist in `docs/adr/0001-effect.md`.
 */
export function singleFlightEffect(run: () => Promise<void>): () => Effect.Effect<void, unknown> {
  const gate = Effect.unsafeMakeSemaphore(1);
  let flight: Deferred.Deferred<void, unknown> | undefined;

  function join(): Deferred.Deferred<void, unknown> {
    return Effect.runSync(
      gate.withPermits(1)(
        Effect.sync(() => {
          if (flight) return flight;
          const own = Deferred.unsafeMake<void, unknown>(FiberId.none);
          flight = own;
          run().then(
            () => {
              flight = undefined;
              Deferred.unsafeDone(own, Effect.void);
            },
            (cause: unknown) => {
              flight = undefined;
              Deferred.unsafeDone(own, Effect.fail(cause));
            },
          );
          return own;
        }),
      ),
    );
  }

  return () => Deferred.await(join());
}
