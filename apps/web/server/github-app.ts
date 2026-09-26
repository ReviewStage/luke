import {
  GITHUB_FAILURE,
  GITHUB_UNAVAILABLE_ERROR,
  type GitHubFailure,
  type GitHubFailureAnswer,
} from "@sidecar/hosted/github-wire";
import { Effect, Layer, Option, Result } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/unstable/http";
import { GitHubAccess, type GitHubUnavailable, listRepositories } from "./hosted/github-source.js";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusalResponse,
  type UserIdResolver,
} from "./hosted/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * github-app.ts -- the repositories the account's GitHub connection can read, for the planning window's picker.
 *
 * The window cannot ask GitHub itself, because only the service holds the
 * connection's credential, so it asks here: the bearer names the account,
 * the account's connection is read for that request alone, and what answers
 * is each repository's owner, name, and whether it is private. A connection
 * GitHub refused, or none at all, answers `GITHUB_UNAVAILABLE_ERROR` with
 * its reason, the same answer starting a plan gives.
 */

const GITHUB_PATH = {
  /** GET lists. */
  REPOSITORIES: "/api/github/repositories",
} as const;

const HTTP_METHOD_GET = "GET";

/** A GitHub refusal answers conflict: the request was sound and the account's connection could not carry it. */
const GITHUB_FAILURE_STATUS = {
  [GITHUB_FAILURE.NOT_CONNECTED]: HOSTED_HTTP_STATUS.CONFLICT,
  [GITHUB_FAILURE.ACCESS_DENIED]: HOSTED_HTTP_STATUS.CONFLICT,
  [GITHUB_FAILURE.NOT_FOUND]: HOSTED_HTTP_STATUS.CONFLICT,
  [GITHUB_FAILURE.EMPTY_REPOSITORY]: HOSTED_HTTP_STATUS.CONFLICT,
  [GITHUB_FAILURE.RATE_LIMITED]: HOSTED_HTTP_STATUS.BAD_GATEWAY,
  [GITHUB_FAILURE.FAILED]: HOSTED_HTTP_STATUS.BAD_GATEWAY,
} as const satisfies Record<GitHubFailure, number>;

/** Why a GitHub read under the account's connection answered nothing, as the response the window reads. */
export function githubFailureResponse(
  failure: GitHubUnavailable,
): HttpServerResponse.HttpServerResponse {
  const answer: GitHubFailureAnswer = { error: GITHUB_UNAVAILABLE_ERROR, reason: failure.reason };
  return hostedJsonResponse(GITHUB_FAILURE_STATUS[failure.reason], answer);
}

export interface GitHubAppSeams {
  resolveUserId: UserIdResolver;
}

/** GET lists the repositories the account's connection can read. */
const repositoriesEndpoint = /* @__PURE__ */ Effect.fn("web/githubRepositoriesEndpoint")(function* (
  seams: GitHubAppSeams,
) {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD_GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const github = yield* GitHubAccess;
  const listed = yield* github
    .token(account.value)
    .pipe(Effect.flatMap(listRepositories), Effect.result);
  if (Result.isFailure(listed)) return githubFailureResponse(listed.failure);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, listed.success);
});

/** An endpoint's refusal carried back onto the answer channel, the way the account group does. */
function refusing<R>(
  endpoint: Effect.Effect<HttpServerResponse.HttpServerResponse, HostedRefusal, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> {
  return Effect.catch(endpoint, (refusal) => Effect.succeed(hostedRefusalResponse(refusal)));
}

/** The group: the repository list, and the hosted vocabulary's own refusal for any other path. */
export function githubApp(seams: GitHubAppSeams): WebRoutes<HttpClient.HttpClient | GitHubAccess> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, GITHUB_PATH.REPOSITORIES, refusing(repositoriesEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
