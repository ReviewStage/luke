/**
 * github-integration.ts -- GitHub as an integration, granted by the account's own GitHub sign-in.
 *
 * GitHub's MCP server takes a GitHub App user token, and an account that
 * signed in with GitHub already holds one: the token its sign-in left on its
 * account row, which `GitHubApp.userToken` reads and refreshes. So GitHub
 * has no connector, no `integration_connection` row, and no Connect or
 * Disconnect of its own (`INTEGRATION_GRANT_OF`): it stands connected
 * whenever that sign-in does, reaches what the Luke GitHub App reaches for
 * the account, and is mended by signing in with GitHub again. The token is
 * read afresh at every ask, never kept here.
 */

import type { DatabaseServices } from "@sidecar/database/core/query";
import { INTEGRATION_STATUS, type IntegrationStatus } from "@sidecar/hosted/integration-wire";
import { Clock, Effect, Result } from "effect";
import type { HttpClient } from "effect/http";
import {
  GitHubApp,
  type GitHubUserReadFailure,
  USER_TOKEN_REFRESH_MARGIN_MS,
} from "../github/github-app.js";
import type { IntegrationToken } from "./integration-connect.js";

/** Why the account's GitHub sign-in grants nothing just now. */
export const GITHUB_GRANT_REFUSAL = {
  /** The deployment holds no GitHub App, so nothing is offered. */
  NOT_CONFIGURED: "not-configured",
  /** The account has no GitHub sign-in, or one GitHub no longer honours: signing in with GitHub mends it. */
  SIGN_IN_REQUIRED: "sign-in-required",
  /** GitHub or the store could not be asked for the token just now. */
  UNREACHABLE: "unreachable",
} as const;

export type GitHubGrantRefusal = (typeof GITHUB_GRANT_REFUSAL)[keyof typeof GITHUB_GRANT_REFUSAL];

/** Where GitHub stands for the account, by why its token could not be read. */
const STATUS_OF_REFUSAL = {
  [GITHUB_GRANT_REFUSAL.NOT_CONFIGURED]: INTEGRATION_STATUS.UNAVAILABLE,
  [GITHUB_GRANT_REFUSAL.SIGN_IN_REQUIRED]: INTEGRATION_STATUS.DISCONNECTED,
  // Note that the sign-in still stands when GitHub only failed to answer a refresh.
  [GITHUB_GRANT_REFUSAL.UNREACHABLE]: INTEGRATION_STATUS.CONNECTED,
} as const satisfies Record<GitHubGrantRefusal, IntegrationStatus>;

/** The refusal a failed token read amounts to. */
function refusalOf(failure: GitHubUserReadFailure): GitHubGrantRefusal {
  if (failure._tag === "GitHubAppNotConfigured") return GITHUB_GRANT_REFUSAL.NOT_CONFIGURED;
  if (failure._tag === "GitHubSignInRequired") return GITHUB_GRANT_REFUSAL.SIGN_IN_REQUIRED;
  // GitHub that did not answer, and a store that could not be read.
  return GITHUB_GRANT_REFUSAL.UNREACHABLE;
}

/**
 * The account's GitHub App user token as an integration's credential, or
 * why there is none. It is said to expire within the margin `userToken`
 * refreshes inside, so a token handed out is good at least that long and
 * the next ask after it reads, and if need be refreshes, afresh.
 */
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

/** Where GitHub stands for the account: connected while its GitHub sign-in yields a token. */
export function githubIntegrationStatus(
  userId: string,
): Effect.Effect<IntegrationStatus, never, GitHubApp | HttpClient.HttpClient | DatabaseServices> {
  return Effect.map(githubSignInGrant(userId), (grant) =>
    Result.isSuccess(grant) ? INTEGRATION_STATUS.CONNECTED : STATUS_OF_REFUSAL[grant.failure],
  );
}

/** Whether this deployment offers GitHub at all: it holds the whole of the GitHub App. */
export const githubOffered: Effect.Effect<boolean, never, GitHubApp> = Effect.gen(function* () {
  return yield* Effect.isSuccess((yield* GitHubApp).installUrl);
});
