/**
 * github-refusal.ts -- a GitHub read carried onto the hosted answer channel, and written down by its kind alone.
 *
 * A read of a workspace's installation fails in two kinds: an App or a
 * GitHub the service could not reach, or a store that could not name the
 * installation. Both are an outage the caller may retry, refused as
 * unavailable, and logged by kind: nothing of a token, the request that
 * carried it, or GitHub's body reaches a line. Where the read is whether
 * the workspace reaches a task's repository, a GitHub that did not answer is
 * refused as its own kind, so the desktop says GitHub, not Luke, failed.
 */

import { Effect } from "effect";
import { HOSTED_REFUSAL, type HostedRefusal } from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";
import type { GitHubReadFailure, GitHubWorkspaceReadFailure } from "./github-app.js";

/** The failure as one warning line of kinds alone. */
export function logGitHubReadFailure(failure: GitHubReadFailure): Effect.Effect<void> {
  return Effect.logWarning(`GitHub App read failed: ${failure.message}`);
}

/** A workspace read's failure as one warning line of kinds alone. */
export function logWorkspaceReadFailure(failure: GitHubWorkspaceReadFailure): Effect.Effect<void> {
  switch (failure._tag) {
    case "GitHubAppNotConfigured":
    case "GitHubUnavailable":
      return logGitHubReadFailure(failure);
    default:
      return logStoreFailure(failure);
  }
}

/** A read of the workspace's installation the handler cannot answer without, refused on the terms above. */
export function githubReadOrRefusal<A, R>(
  effect: Effect.Effect<A, GitHubWorkspaceReadFailure, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return effect.pipe(
    Effect.tapError(logWorkspaceReadFailure),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );
}

/** A read of whether the workspace reaches a repository, refused on the terms above, a GitHub that did not answer as unanswered. */
export function githubReachOrRefusal<A, R>(
  effect: Effect.Effect<A, GitHubWorkspaceReadFailure, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return effect.pipe(
    Effect.tapError(logWorkspaceReadFailure),
    Effect.mapError((failure) =>
      failure._tag === "GitHubUnavailable"
        ? HOSTED_REFUSAL.GITHUB_UNANSWERED
        : HOSTED_REFUSAL.UNAVAILABLE,
    ),
  );
}
