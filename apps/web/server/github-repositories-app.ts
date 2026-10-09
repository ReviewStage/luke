/**
 * github-repositories-app.ts -- the repositories the signed-in developer reaches through the Luke GitHub App.
 *
 * One read under the account bearer, `GET /api/github/repositories`, which
 * is what the desktop's repository chip lists from. The answer is read from
 * GitHub on the account's own token the moment it is asked for and stored
 * nowhere: every repository the App reaches for the account, most recently
 * updated first, whether the account has installed the App anywhere at all,
 * and where to send them to install it. An account that must sign in with
 * GitHub again is told so; a GitHub or a store the service could not reach
 * is unavailable.
 */

import { type GitHubRepositoriesAnswer, HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import { Effect, Layer, Option } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import { GitHubApp } from "./github/github-app.js";
import { githubUserReadOrRefusal } from "./github/github-refusal.js";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedMethod,
  hostedNotFoundRoute,
  hostedRefusing,
  type UserIdResolver,
} from "./hosted/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

const HTTP_METHOD = { GET: "GET" } as const;

export interface GitHubRepositoriesAppSeams {
  resolveUserId: UserIdResolver;
}

/** What the route may require of the function that stands it. */
export type GitHubRepositoriesAppServices = SqlClient.SqlClient | GitHubApp | HttpClient.HttpClient;

/** GET: the repositories the bearer's account reaches through the App. */
const repositoriesEndpoint = /* @__PURE__ */ Effect.fn("web/githubRepositoriesEndpoint")(function* (
  seams: GitHubRepositoriesAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  GitHubRepositoriesAppServices | HttpServerRequest.HttpServerRequest
> {
  yield* hostedMethod(HTTP_METHOD.GET);
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const app = yield* GitHubApp;
  const [reached, installationUrl] = yield* githubUserReadOrRefusal(
    Effect.all([app.userRepositories(account.value), app.installUrl]),
  );
  const answer: GitHubRepositoriesAnswer = {
    installed: reached.installed,
    repositories: reached.repositories,
    installationUrl,
  };
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, answer);
});

/** The group: the one read, and the hosted vocabulary's own refusal for any other path. */
export function githubRepositoriesApp(
  seams: GitHubRepositoriesAppSeams,
): WebRoutes<GitHubRepositoriesAppServices> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.GITHUB_REPOSITORIES,
      hostedRefusing(repositoriesEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}
