import type { AccountClientFailure, CloudFailure } from "@sidecar/core/effect-errors";
import { Deferred, Effect, Ref } from "effect";
import type { AccountTokens } from "./account-client";
import type { Http } from "./services/http";

/**
 * Collapses concurrent asks for a refresh into one in-flight run, and every
 * caller awaits that run's outcome. The refresh token rotates when spent, so
 * two refreshes racing — a hosted mint and a review both answering 401 at the
 * hour mark — would have the loser spend an already-rotated token, and the
 // SAFETY: The preceding check establishes the asserted contract.
 * token endpoint's `invalid_grant` for it reads as revocation: a sign-out
 * right after a successful refresh. A run that ends, ends the flight; the next
 * ask starts a fresh one holding the newly rotated token.
 */
export function singleFlight<R = unknown>(
  run: () => Effect.Effect<void, unknown, R>,
): () => Effect.Effect<void, unknown, R> {
  const shared = Ref.unsafeMake<Deferred.Deferred<void, unknown> | undefined>(undefined);
  const lock = Effect.unsafeMakeSemaphore(1);
  return () =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(shared);
        if (current) return yield* Deferred.await(current);
        const created = yield* Deferred.make<void, unknown>();
        yield* Ref.set(shared, created);
        yield* Effect.forkDaemon(
          run().pipe(
            Effect.matchEffect({
              onFailure: (error) => Deferred.fail(created, error),
              onSuccess: () => Deferred.succeed(created, undefined),
            }),
            Effect.ensuring(Ref.set(shared, undefined)),
          ),
        );
        return yield* Deferred.await(created);
      }),
    );
}

/** Like {@link singleFlight}, but shares the successful result with concurrent callers. */
export function singleFlightResult<A, R = unknown>(
  run: () => Effect.Effect<A, unknown, R>,
): () => Effect.Effect<A, unknown, R> {
  const shared = Ref.unsafeMake<Deferred.Deferred<A, unknown> | undefined>(undefined);
  const lock = Effect.unsafeMakeSemaphore(1);
  return () =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(shared);
        if (current) return yield* Deferred.await(current);
        const created = yield* Deferred.make<A, unknown>();
        yield* Ref.set(shared, created);
        yield* Effect.forkDaemon(
          run().pipe(
            Effect.matchEffect({
              onFailure: (error) => Deferred.fail(created, error),
              onSuccess: (value) => Deferred.succeed(created, value),
            }),
            Effect.ensuring(Ref.set(shared, undefined)),
          ),
        );
        return yield* Deferred.await(created);
      }),
    );
}

/** Ensures credentials rejected before sign-in completes do not outlive the failed attempt. */
export function withIssuedAccountTokens<T, R>(options: {
  issue: () => Effect.Effect<AccountTokens, AccountClientFailure | CloudFailure, Http>;
  use: (tokens: AccountTokens) => Effect.Effect<T, unknown, R>;
  revoke: (refreshToken: string) => Effect.Effect<void, AccountClientFailure | CloudFailure, Http>;
  onRevokeFailure?: (error: unknown) => void;
}): Effect.Effect<T, unknown, Http | R> {
  return Effect.gen(function* () {
    const tokens = yield* options.issue();
    return yield* options.use(tokens).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* options.revoke(tokens.refreshToken).pipe(
            Effect.catchAll((revokeError) => {
              options.onRevokeFailure?.(revokeError);
              return Effect.void;
            }),
          );
          return yield* Effect.fail(error);
        }),
      ),
    );
  });
}
