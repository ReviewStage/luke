/**
 * github-repositories-app.ts -- the repositories the signed-in developer reaches through the Luke GitHub App.
 *
 * One read under the account bearer, `GET /api/github/repositories`, which
 * is what the desktop's repository chip lists from. The answer is read from
 * GitHub on the account's own token the moment it is asked for and stored
 * nowhere: every repository the App reaches for the account, most recently
 * updated first, whether the account has installed the App anywhere at all,
 * and where to send them to install it. A listing for a workspace of an
 * installation, named in the `workspaceId` query, is that installation's
 * repositories alone, to a member of it; a workspace the account is not in
 * is not found. A personal workspace, or none named, lists everything. An
 * account that must sign in with GitHub again is told so; a GitHub or a
 * store the service could not reach is unavailable.
 */

import {
  GITHUB_REPOSITORIES_QUERY,
  type GitHubRepositoriesAnswer,
  HOSTED_SERVICE_PATH,
} from "@sidecar/hosted";
import { workspaceIdSchema } from "@sidecar/hosted/plan-wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import { unparsedWire } from "./core.js";
import { GitHubApp } from "./github/github-app.js";
import { githubUserReadOrRefusal } from "./github/github-refusal.js";
import { installationOfWorkspace } from "./hosted/github-installations.js";
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
import { isWorkspaceMember } from "./hosted/workspace-store.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

const HTTP_METHOD = { GET: "GET" } as const;

export interface GitHubRepositoriesAppSeams {
  resolveUserId: UserIdResolver;
}

/** What the route may require of the function that stands it. */
export type GitHubRepositoriesAppServices = SqlClient.SqlClient | GitHubApp | HttpClient.HttpClient;

/**
 * The installation the listing is scoped to: none where no workspace is
 * named or the one named is personal, and not found for a workspace the
 * account is not a member of. More than one named, or one off the wire's
 * shape, is an invalid request.
 */
const listedInstallation = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  request: Request,
): Effect.fn.Return<Option.Option<number>, HostedRefusal, SqlClient.SqlClient> {
  const named = new URL(request.url).searchParams.getAll(GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID);
  if (named.length === 0) return Option.none();
  const read = readEither(workspaceIdSchema)(unparsedWire(named[0]));
  if (named.length !== 1 || Result.isFailure(read)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, read.success));
  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return yield* hostedStoreOrUnavailable(installationOfWorkspace(read.success));
});

/** GET: the repositories the bearer's account reaches through the App, or through the named workspace's installation. */
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
  const installation = yield* listedInstallation(account.value, request);
  const app = yield* GitHubApp;
  // Note that a workspace of an installation is installed by its being one, whatever its repositories.
  const listing = Option.match(installation, {
    onNone: () => app.userRepositories(account.value),
    onSome: (installationId) =>
      Effect.map(
        app.userInstallationRepositories(account.value, installationId),
        (repositories) => ({
          installed: true,
          repositories,
        }),
      ),
  });
  const [reached, installationUrl] = yield* githubUserReadOrRefusal(
    Effect.all([listing, app.installUrl]),
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
