/**
 * github-repositories-app.ts -- the repositories of a workspace: those of the GitHub installation connected to it, and one of them's tree, skills, pull requests, and issues.
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
 *
 * Beside it, one repository of the workspace's installation is read by the
 * workspace and its name, for a place no plan names, such as an agent an
 * automation started: `GET /api/github/repositories/tree`, one folder of it,
 * and `GET /api/github/repositories/skills`, the skills a developer may
 * choose of it, each answered exactly as a plan's own read answers
 * (`plans/plan-tree.ts`, `plans/plan-skills.ts`) to a member of the
 * workspace, through the same reach of its installation; a workspace the
 * account is not in is not found, and a repository the installation does
 * not reach is refused as a plan's is.
 *
 * And one pull request of such a repository is read by its number, for a
 * link to it to draw its title and where it stands:
 * `GET /api/github/repositories/pull-request`, on a token the installation
 * mints for that one repository with pull requests read
 * (`pull-requests.ts`), to a member of the workspace, answering its number,
 * title, page, and state and nothing more of it. A repository the
 * installation does not reach and a number the repository holds no pull
 * request under both answer none, since a link to either draws the same; a
 * workspace the account is not in is not found, as above.
 *
 * And one issue is read the same way, `GET /api/github/repositories/issue`,
 * on a token minted for the one repository with issues read alone
 * (`issues.ts`), answering its number, title, page, and state; an
 * installation that does not grant the App issues answers none, as an
 * unreached repository does, so a link to an issue there draws its address.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { isWorkspaceMember, personalWorkspaceOf } from "@luke/database/models/workspace-store";
import {
  GITHUB_REPOSITORIES_QUERY,
  type GitHubIssueSummary,
  type GitHubPullRequestSummary,
  type GitHubRepositoriesAnswer,
  type GitHubRepositoryIssueAnswer,
  type GitHubRepositoryPullRequestAnswer,
  githubPullRequestNumberSchema,
  githubRepositoryFullNameSchema,
  HOSTED_SERVICE_PATH,
} from "@luke/features";
import { workspaceIdSchema } from "@luke/features/task-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import { type GitHubRepository, unparsedWire } from "../core.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedMethod,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { readWorkspaceSkills } from "../tasks/task-skills.js";
import { readRepositoryTree, treeRequestOf } from "../tasks/task-tree.js";
import { GitHubApp, type GitHubWorkspaceReadFailure } from "./github-app.js";
import { githubReadOrRefusal } from "./github-refusal.js";
import { issueByNumber } from "./issues.js";
import { pullRequestByNumber } from "./pull-requests.js";

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

/** The one value a query names, read by the schema given, or the invalid-request refusal where it is absent, named more than once, or off the wire's shape. */
const namedOnce = <A>(
  request: Request,
  name: string,
  read: (value: string) => Result.Result<A, unknown>,
) =>
  Effect.gen(function* () {
    const named = new URL(request.url).searchParams.getAll(name);
    const value = named.length === 1 ? read(named[0] ?? "") : undefined;
    if (value === undefined || Result.isFailure(value)) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    }
    return value.success;
  });

/**
 * The repository the query names and the workspace whose installation it is
 * read through, where the account is a member of that workspace: one not a
 * member of is not found, and either query absent, named more than once, or
 * off the wire's shape is an invalid request.
 */
const repositoryPlace = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  request: Request,
): Effect.fn.Return<
  { readonly workspaceId: string; readonly repository: string },
  HostedRefusal,
  DatabaseServices
> {
  const workspaceId = yield* namedOnce(request, GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID, (value) =>
    readEither(workspaceIdSchema)(unparsedWire(value)),
  );
  const repository = yield* namedOnce(request, GITHUB_REPOSITORIES_QUERY.REPOSITORY, (value) =>
    readEither(githubRepositoryFullNameSchema)(unparsedWire(value)),
  );
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, workspaceId));
  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return { workspaceId, repository };
});

/** The account the bearer names, and the request as the web reads it, for a GET; anything else refused. */
const signedInGet = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: GitHubRepositoriesAppSeams,
): Effect.fn.Return<
  { readonly userId: string; readonly request: Request },
  HostedRefusal,
  HttpServerRequest.HttpServerRequest
> {
  yield* hostedMethod(HTTP_METHOD.GET);
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return { userId: account.value, request };
});

/** GET: one folder of a repository the workspace's installation reaches, or why it is not listed. */
const treeEndpoint = /* @__PURE__ */ Effect.fn("web/githubRepositoryTreeEndpoint")(function* (
  seams: GitHubRepositoriesAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  GitHubRepositoriesAppServices | HttpServerRequest.HttpServerRequest
> {
  const { userId, request } = yield* signedInGet(seams);
  const place = yield* repositoryPlace(userId, request);
  const folder = yield* treeRequestOf(request);
  const tree = yield* readRepositoryTree(place.workspaceId, place.repository, folder);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, tree);
});

/** GET: the skills a developer may choose of a repository the workspace's installation reaches, or why they are not read. */
const skillsEndpoint = /* @__PURE__ */ Effect.fn("web/githubRepositorySkillsEndpoint")(function* (
  seams: GitHubRepositoriesAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  GitHubRepositoriesAppServices | HttpServerRequest.HttpServerRequest
> {
  const { userId, request } = yield* signedInGet(seams);
  const place = yield* repositoryPlace(userId, request);
  const skills = yield* readWorkspaceSkills(place.workspaceId, place.repository);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, skills);
});

/**
 * The pull request of the number given, of a repository the workspace's
 * installation reaches, as much of it as a link draws; none where the
 * installation does not reach the repository or the repository holds none
 * of that number. Note that the token is minted for the one repository and
 * dropped with the answer, because a link is read again rather than held.
 */
const pullRequestOfPlace = /* @__PURE__ */ Effect.fnUntraced(function* (
  place: { readonly workspaceId: string; readonly repository: string },
  number: number,
): Effect.fn.Return<
  GitHubPullRequestSummary | null,
  GitHubWorkspaceReadFailure,
  GitHubRepositoriesAppServices
> {
  const app = yield* GitHubApp;
  const reached = yield* app.repositoryPullRequestToken(place.workspaceId, place.repository);
  if (Option.isNone(reached)) return null;
  const found = yield* pullRequestByNumber(reached.value.token, place.repository, number);
  if (Option.isNone(found)) return null;
  const { title, url, state } = found.value;
  return { number: found.value.number, title, url, state };
});

/** GET: one pull request of a repository the workspace's installation reaches, by its number, or none where there is none to draw. */
const pullRequestEndpoint = /* @__PURE__ */ Effect.fn("web/githubRepositoryPullRequestEndpoint")(
  function* (
    seams: GitHubRepositoriesAppSeams,
  ): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    GitHubRepositoriesAppServices | HttpServerRequest.HttpServerRequest
  > {
    const { userId, request } = yield* signedInGet(seams);
    const place = yield* repositoryPlace(userId, request);
    const number = yield* namedOnce(request, GITHUB_REPOSITORIES_QUERY.NUMBER, (value) =>
      readEither(githubPullRequestNumberSchema)(unparsedWire(Number(value))),
    );
    const pullRequest = yield* githubReadOrRefusal(pullRequestOfPlace(place, number));
    const answer: GitHubRepositoryPullRequestAnswer = { pullRequest };
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, answer);
  },
);

/** The issue of the number given, of a repository the workspace's installation reaches, as a link draws it; none where there is none to draw, as `pullRequestOfPlace` answers. */
const issueOfPlace = /* @__PURE__ */ Effect.fnUntraced(function* (
  place: { readonly workspaceId: string; readonly repository: string },
  number: number,
): Effect.fn.Return<
  GitHubIssueSummary | null,
  GitHubWorkspaceReadFailure,
  GitHubRepositoriesAppServices
> {
  const app = yield* GitHubApp;
  const reached = yield* app.repositoryIssueToken(place.workspaceId, place.repository);
  if (Option.isNone(reached)) return null;
  const found = yield* issueByNumber(reached.value.token, place.repository, number);
  return Option.getOrNull(found);
});

/** GET: one issue of a repository the workspace's installation reaches, by its number, or none where there is none to draw. */
const issueEndpoint = /* @__PURE__ */ Effect.fn("web/githubRepositoryIssueEndpoint")(function* (
  seams: GitHubRepositoriesAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  GitHubRepositoriesAppServices | HttpServerRequest.HttpServerRequest
> {
  const { userId, request } = yield* signedInGet(seams);
  const place = yield* repositoryPlace(userId, request);
  const number = yield* namedOnce(request, GITHUB_REPOSITORIES_QUERY.NUMBER, (value) =>
    readEither(githubPullRequestNumberSchema)(unparsedWire(Number(value))),
  );
  const issue = yield* githubReadOrRefusal(issueOfPlace(place, number));
  const answer: GitHubRepositoryIssueAnswer = { issue };
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, answer);
});

/** GET: the repositories of the workspace's installation, and whether it has one. */
const repositoriesEndpoint = /* @__PURE__ */ Effect.fn("web/githubRepositoriesEndpoint")(function* (
  seams: GitHubRepositoriesAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  GitHubRepositoriesAppServices | HttpServerRequest.HttpServerRequest
> {
  const { userId, request } = yield* signedInGet(seams);
  const workspace = yield* listedWorkspace(userId, request);
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

/** The group: the listing, one repository's tree, skills, pull request, and issue, and the hosted vocabulary's own refusal for any other path. */
export function githubRepositoriesApp(
  seams: GitHubRepositoriesAppSeams,
): WebRoutes<GitHubRepositoriesAppServices> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.GITHUB_REPOSITORIES,
      hostedRefusing(repositoriesEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_TREE,
      hostedRefusing(treeEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_SKILLS,
      hostedRefusing(skillsEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_PULL_REQUEST,
      hostedRefusing(pullRequestEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_ISSUE,
      hostedRefusing(issueEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}
