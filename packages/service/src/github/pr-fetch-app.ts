/**
 * pr-fetch-app.ts -- a pull request's head and a token to fetch it with, for the Mac that runs it locally.
 *
 * One call under the account bearer, `POST /api/github/pr-fetch`, naming the
 * workspace, the repository, and the pull request's number. A workspace the
 * account is not in, and a pull request the repository does not hold, are
 * not found; a repository the workspace's installation does not reach is
 * refused as out of reach. The pull request is read by number on GitHub the
 * moment it is asked for, on a token minted for that read alone that never
 * leaves this handler; the answer is its head commit and a second token,
 * limited to the one repository and to contents read, which is all a fetch
 * of `refs/pull/<number>/head` needs. The answer is sent `no-store`, and
 * nothing of either token reaches a log line: a failure is logged by kind.
 * Nothing is stored.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { isWorkspaceMember } from "@luke/database/models/workspace-store";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { type PrFetchAnswer, prFetchRequestSchema } from "@luke/features/pr-fetch-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Redacted, Result } from "effect";
import { type HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type UserIdResolver,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { GitHubApp } from "./github-app.js";
import { githubReachOrRefusal } from "./github-refusal.js";
import { pullRequestByNumber } from "./pull-requests.js";

const HTTP_METHOD = { POST: "POST" } as const;

/** The request is three short fields; anything heavier is not one. */
const MAXIMUM_REQUEST_BODY_BYTES = 4 * 1_024;

/** The answer carries a credential, so nothing between here and the Mac keeps it. */
const NO_STORE_HEADERS = { "cache-control": "private, no-store" } as const;

export interface PrFetchAppSeams {
  resolveUserId: UserIdResolver;
}

/** What the route may require of the function that stands it. */
export type PrFetchAppServices = DatabaseServices | GitHubApp | HttpClient.HttpClient;

/** POST: the pull request's head, and a contents-read token for its repository alone. */
const prFetchEndpoint = /* @__PURE__ */ Effect.fn("web/githubPrFetchEndpoint")(function* (
  seams: PrFetchAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  PrFetchAppServices | HttpServerRequest.HttpServerRequest
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const body = yield* readJsonBodyEffect(MAXIMUM_REQUEST_BODY_BYTES);
  const asked = readEither(prFetchRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { workspaceId, repository, prNumber } = asked.success;
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(account.value, workspaceId));
  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const app = yield* GitHubApp;
  // Note that the pull request is read on a token of its own, because reading it needs pull requests read, which the token the Mac is handed must not carry.
  const reading = yield* githubReachOrRefusal(
    app.repositoryPullRequestToken(workspaceId, repository),
  );
  if (Option.isNone(reading)) return yield* Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
  const pullRequest = yield* githubReachOrRefusal(
    pullRequestByNumber(reading.value.token, reading.value.repository.fullName, prNumber),
  );
  if (Option.isNone(pullRequest)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const fetching = yield* githubReachOrRefusal(app.repositoryReadToken(workspaceId, repository));
  if (Option.isNone(fetching)) return yield* Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
  const answer: PrFetchAnswer = {
    workspaceId,
    repository: fetching.value.repository.fullName,
    prNumber,
    headSha: pullRequest.value.headSha,
    headRef: pullRequest.value.headRef,
    token: Redacted.value(fetching.value.token),
    expiresAt: fetching.value.expiresAt,
  };
  return HttpServerResponse.jsonUnsafe(answer, {
    status: HOSTED_HTTP_STATUS.OK,
    headers: NO_STORE_HEADERS,
  });
});

/** The group: the one call, and the hosted vocabulary's own refusal for any other path. */
export function prFetchApp(seams: PrFetchAppSeams): WebRoutes<PrFetchAppServices> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.GITHUB_PR_FETCH,
      hostedRefusing(prFetchEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}
