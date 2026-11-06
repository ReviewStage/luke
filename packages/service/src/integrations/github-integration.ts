import type { DatabaseServices } from "@repo/database/core/query";
import { INTEGRATION_STATUS, type IntegrationStatus } from "@repo/features/integration-wire";
import { Clock, Effect, Result } from "effect";
import type { HttpClient } from "effect/http";
import {
  GitHubApp,
  type GitHubUserReadFailure,
  USER_TOKEN_REFRESH_MARGIN_MS,
} from "../github/github-app.js";
import type { IntegrationToken } from "./integration-connect.js";

export const GITHUB_GRANT_REFUSAL = {
  NOT_CONFIGURED: "not-configured",
  SIGN_IN_REQUIRED: "sign-in-required",
  UNREACHABLE: "unreachable",
} as const;

export type GitHubGrantRefusal = (typeof GITHUB_GRANT_REFUSAL)[keyof typeof GITHUB_GRANT_REFUSAL];

const STATUS_OF_REFUSAL = {
  [GITHUB_GRANT_REFUSAL.NOT_CONFIGURED]: INTEGRATION_STATUS.UNAVAILABLE,
  [GITHUB_GRANT_REFUSAL.SIGN_IN_REQUIRED]: INTEGRATION_STATUS.DISCONNECTED,
  [GITHUB_GRANT_REFUSAL.UNREACHABLE]: INTEGRATION_STATUS.CONNECTED,
} as const satisfies Record<GitHubGrantRefusal, IntegrationStatus>;

function refusalOf(failure: GitHubUserReadFailure): GitHubGrantRefusal {
  if (failure._tag === "GitHubAppNotConfigured") return GITHUB_GRANT_REFUSAL.NOT_CONFIGURED;
  if (failure._tag === "GitHubSignInRequired") return GITHUB_GRANT_REFUSAL.SIGN_IN_REQUIRED;
  return GITHUB_GRANT_REFUSAL.UNREACHABLE;
}

export const githubSignInGrant = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
): Effect.fn.Return<
  Result.Result<IntegrationToken, GitHubGrantRefusal>,
  never,
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  const read = yield* Effect.result((yield* GitHubApp).userToken(userId));
  if (Result.isFailure(read)) return Result.fail(refusalOf(read.failure));
  const now = yield* Clock.currentTimeMillis;
  return Result.succeed({ token: read.success, expiresAt: now + USER_TOKEN_REFRESH_MARGIN_MS });
});

export function githubIntegrationStatus(
  userId: string,
): Effect.Effect<IntegrationStatus, never, GitHubApp | HttpClient.HttpClient | DatabaseServices> {
  return Effect.map(githubSignInGrant(userId), (grant) =>
    Result.isSuccess(grant) ? INTEGRATION_STATUS.CONNECTED : STATUS_OF_REFUSAL[grant.failure],
  );
}

export const githubOffered: Effect.Effect<boolean, never, GitHubApp> = Effect.gen(function* () {
  return yield* Effect.isSuccess((yield* GitHubApp).installUrl);
});
