/**
 * github-refusal.ts -- a GitHub read carried onto the hosted answer channel, and written down by its kind alone.
 *
 * A read on the user's token fails in three kinds. A token the user must
 * renew is their own to mend, by signing in with GitHub again, and travels
 * as that refusal. A store, an App, or a GitHub the service could not reach
 * is an outage the caller may retry, refused as unavailable. Both are logged
 * by kind: nothing of the token, the request that carried it, or GitHub's
 * body reaches a line.
 */

import { Effect } from "effect";
import { HOSTED_REFUSAL, type HostedRefusal } from "../hosted/http-effect.js";
import { logStoreFailure } from "../hosted/store-failure.js";
import type { GitHubReadFailure, GitHubUserReadFailure } from "./github-app.js";

/** The failure as one warning line of kinds alone. */
export function logGitHubReadFailure(failure: GitHubReadFailure): Effect.Effect<void> {
  return Effect.logWarning(`GitHub App read failed: ${failure.message}`);
}

function logUserReadFailure(failure: GitHubUserReadFailure): Effect.Effect<void> {
  switch (failure._tag) {
    case "GitHubSignInRequired":
      // The user's own state, answered to them rather than written down.
      return Effect.void;
    case "GitHubAppNotConfigured":
    case "GitHubUnavailable":
      return logGitHubReadFailure(failure);
    default:
      return logStoreFailure(failure);
  }
}

/** A read on the user's token the handler cannot answer without, refused on the terms above. */
export function githubUserReadOrRefusal<A, R>(
  effect: Effect.Effect<A, GitHubUserReadFailure, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return effect.pipe(
    Effect.tapError(logUserReadFailure),
    Effect.mapError((failure) =>
      failure._tag === "GitHubSignInRequired"
        ? HOSTED_REFUSAL.GITHUB_SIGN_IN_REQUIRED
        : HOSTED_REFUSAL.UNAVAILABLE,
    ),
  );
}
