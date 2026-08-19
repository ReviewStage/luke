import type { AccountClientFailure, CloudFailure } from "@sidecar/core/effect-errors";
import { Effect, Ref } from "effect";
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
export function singleFlight(
  run: () => Effect.Effect<void, unknown, unknown>,
): () => Effect.Effect<void, unknown, unknown> {
  const running = Ref.unsafeMake<Effect.Effect<void, unknown, unknown> | undefined>(undefined);
  return () =>
    Effect.gen(function* () {
      const current = yield* Ref.get(running);
      if (current) return yield* current;
      const flight = run().pipe(Effect.ensuring(Ref.set(running, undefined)));
      yield* Ref.set(running, flight);
      return yield* flight;
    });
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
