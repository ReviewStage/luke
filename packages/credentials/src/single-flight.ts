/**
 * Collapses concurrent asks for a refresh into one in-flight run, and every
 * caller awaits that run's outcome. The refresh token rotates when spent, so
 * two refreshes racing — a hosted mint and a review both answering 401 at the
 * hour mark — would have the loser spend an already-rotated token, and the
 * token endpoint's `invalid_grant` for it reads as revocation: a sign-out
 * right after a successful refresh. A run that ends, ends the flight; the next
 * ask starts a fresh one holding the newly rotated token.
 */
export function singleFlight(run: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | undefined;
  return () => {
    running ??= run().finally(() => {
      running = undefined;
    });
    return running;
  };
}
