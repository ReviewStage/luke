/**
 * github-repositories-app.ts -- the repositories of a workspace: those of the GitHub installation connected to it.
 *
 * One read under the account bearer, `GET /api/github/repositories`, which
 * is what the desktop's repository chip lists from. The answer is read from
 * GitHub on a token the App mints for the listing the moment it is asked
 * for and stored nowhere: every repository of the installation connected to
 * the workspace named in the `workspaceId` query, or to the account's
 * first workspace where none is named, most recently updated first, to a
 * member of it, and whether one is connected at all; a workspace the
 * account is not in is not found. A workspace with nothing connected has no
 * repositories. A GitHub or a store the service could not reach is
 * unavailable.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { isWorkspaceMember, personalWorkspaceOf } from "@luke/database/models/workspace-store";
import {
  GITHUB_REPOSITORIES_QUERY,
  type GitHubRepositoriesAnswer,
  HOSTED_SERVICE_PATH,
} from "@luke/features";
import { workspaceIdSchema } from "@luke/features/plan-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import { type GitHubRepository, unparsedWire } from "./core.js";
import { GitHubApp } from "./github/github-app.js";
import { githubReadOrRefusal } from "./github/github-refusal.js";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedMethod,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "./hosted/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

const HTTP_METHOD = { GET: "GET" } as const;

export interface GitHubRepositoriesAppSeams {
  resolveUserId: UserIdResolver;
}

/** What the route may require of the function that stands it. */
export type GitHubRepositoriesAppServices = DatabaseServices | GitHubApp | HttpClient.HttpClient;

/**
 * The workspace the listing is for: the one named, where the account is a
 * member of it, or the account's first one where none is named, which a
 * first read may arrive ahead of and so finds none, with nothing connected.
 * One not a member of is not found; more than one named, or one off the
 * wire's shape, is an invalid request.
 */
const listedWorkspace = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  request: Request,
): Effect.fn.Return<Option.Option<string>, HostedRefusal, DatabaseServices> {
  const named = new URL(request.url).searchParams.getAll(GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID);
  if (named.length === 0) return yield* hostedStoreOrUnavailable(personalWorkspaceOf(userId));
  const read = readEither(workspaceIdSchema)(unparsedWire(named[0]));
  if (named.length !== 1 || Result.isFailure(read)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, read.success));
  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return Option.some(read.success);
});

/** GET: the repositories of the workspace's installation, and whether it has one. */
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
  const workspace = yield* listedWorkspace(account.value, request);
  const app = yield* GitHubApp;
  const [listed, installationUrl] = yield* githubReadOrRefusal(
    Effect.all([
      Option.match(workspace, {
        onNone: () => Effect.succeed(Option.none<readonly GitHubRepository[]>()),
        onSome: app.workspaceRepositories,
      }),
      app.installUrl,
    ]),
  );
  const answer: GitHubRepositoriesAnswer = {
    installed: Option.isSome(listed),
    repositories: Option.getOrElse(listed, () => []),
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
