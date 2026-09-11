import { Cause, Deferred, Effect, Exit, FiberId } from "effect";

/**
 * Collapses concurrent asks for a refresh into one in-flight run, and every
 * caller awaits that run's outcome. The refresh token rotates when spent, so
 * two refreshes racing — a hosted mint and a review both answering 401 at the
 * hour mark — would have the loser spend an already-rotated token, and the
 * token endpoint's `invalid_grant` for it reads as revocation: a sign-out
 * right after a successful refresh. A run that ends, ends the flight; the next
 * ask starts a fresh one holding the newly rotated token.
 *
 * The run itself starts synchronously, exactly as a caller starting a request
 * on the spot expects: the semaphore only guards the check-and-create of the
 * one {@link Deferred} every concurrent caller then joins, so the decision and
 * the run's start are one uninterruptible step and never wait on the Effect
 * runtime's own scheduling.
 *
 * @deprecated The returned closure's `Effect.runPromiseExit` is on the
 * `Effect.runPromise` allowlist in `docs/adr/0001-effect.md`: this package's
 * two callers, `AccountSessionManager.refresh` and `LinearCredentials`'s own
 * renewal, still hold a Promise rather than a fiber. P7-06 moves the Linear
 * caller onto the host's own runtime; the account's holds `refreshOnce`
 * behind an `AccountToken` a hosted client is handed, so it runs this join as
 * an Effect only once `AccountSessionManager.refresh` is one itself.
 */
export function singleFlight(run: () => Promise<void>): () => Promise<void> {
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

  return () =>
    Effect.runPromiseExit(Deferred.await(join())).then((exit) => {
      if (Exit.isSuccess(exit)) return;
      throw Cause.squash(exit.cause);
    });
}
