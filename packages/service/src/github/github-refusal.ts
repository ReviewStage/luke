import { Effect } from "effect";
import { HOSTED_REFUSAL, type HostedRefusal } from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";
import type { GitHubReadFailure, GitHubWorkspaceReadFailure } from "./github-app.js";

export function logGitHubReadFailure(failure: GitHubReadFailure): Effect.Effect<void> {
  return Effect.logWarning(`GitHub App read failed: ${failure.message}`);
}

export function logWorkspaceReadFailure(failure: GitHubWorkspaceReadFailure): Effect.Effect<void> {
  switch (failure._tag) {
    case "GitHubAppNotConfigured":
    case "GitHubUnavailable":
      return logGitHubReadFailure(failure);
    default:
      return logStoreFailure(failure);
  }
}

export function githubReadOrRefusal<A, R>(
  effect: Effect.Effect<A, GitHubWorkspaceReadFailure, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return effect.pipe(
    Effect.tapError(logWorkspaceReadFailure),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );
}

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
