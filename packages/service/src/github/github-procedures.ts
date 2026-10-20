/**
 * github-procedures.ts -- the account's GitHub and the repositories of a workspace's installation, as one hosted resource.
 *
 * Connecting the account's GitHub: the Mac holds an OAuth access token,
 * not the browser session Better Auth's `linkSocial` needs, so it asks
 * `POST /api/github/connect` on its bearer for an intent and opens the web
 * page the answer names, on the host it asked through, where the browser's
 * session cookie lives. The page claims the intent at
 * `POST /api/github/connect/claim` on that session rather than a bearer:
 * the claim answers claimed only for the account it was made for, and only
 * then does the page ask Better Auth to link GitHub.
 * `GET /api/github/connection` answers whether the account has a GitHub
 * account row with a usable token, and never a token.
 * `POST /api/github/disconnect` removes the account's GitHub link through
 * Better Auth's own `unlinkAccount` (`github-unlink.ts`), under the Mac's
 * Better Auth session, which the bearer plugin reads off the
 * `Authorization` header: an OAuth token alone is no session, so it is
 * refused as unauthenticated, and only the session's own link can go,
 * whichever account a browser happens to be signed in to.
 *
 * The repositories: `GET /api/github/repositories`, which the desktop's
 * repository chip lists from, is read from GitHub on a token the App mints
 * for the listing the moment it is asked for and stored nowhere: every
 * repository of the installation connected to the workspace named in the
 * `workspaceId` query, or to the account's first workspace where none is
 * named, most recently updated first, to a member of it, and whether one is
 * connected at all; a workspace the account is not in is not found. A
 * workspace with nothing connected has no repositories. A member who saved
 * their own GitHub token is listed, beside them, the repositories it may
 * push to that no installation lists, each entry marked with which of the
 * two reaches it. A GitHub or a store the service could not
 * reach is unavailable.
 *
 * Beside it, one repository of the workspace's installation is read by the
 * workspace and its name, for a place no plan names, such as an agent an
 * automation started: `GET /api/github/repositories/tree`, one folder of it,
 * and `GET /api/github/repositories/skills`, the skills a developer may
 * choose of it, each answered exactly as a plan's own read answers
 * (`tasks/task-tree.ts`, `tasks/task-skills.ts`) to a member of the
 * workspace, through the same reach of its installation; a workspace the
 * account is not in is not found, and a repository the installation does
 * not reach is refused as a plan's is, inside the answer.
 *
 * And one pull request of such a repository is read by its number, for a
 * link to it to draw its title and where it stands:
 * `GET /api/github/repositories/pull-request`, on a token the installation
 * mints for that one repository with pull requests read
 * (`pull-requests.ts`), to a member of the workspace, answering its number,
 * title, page, and state and nothing more of it. A repository the
 * installation does not reach and a number the repository holds no pull
 * request under both answer none, since a link to either draws the same.
 * One issue is read the same way, `GET /api/github/repositories/issue`, on
 * a token minted for the one repository with issues read alone
 * (`issues.ts`); an installation that does not grant the App issues
 * answers none, as an unreached repository does, so a link to an issue
 * there draws its address.
 *
 * And the issues New task's picker offers of such a repository,
 * `GET /api/github/repositories/issues`, on the same token: its open issues
 * newest changed first, those GitHub's search finds for the `query` named,
 * or the one issue `number` names, which wins where both are named
 * (`issues.ts`), to a member of the workspace. An installation that has not
 * granted the App issues answers ungranted with its settings page on
 * GitHub, never an empty list, so the picker can say why; a repository the
 * installation does not reach has no issues.
 *
 * Every caller is resolved, and the claim's body bound checked, on the
 * resource's implementer rather than the procedure's, so they run before
 * oRPC reads the input, as the old groups resolved the caller before they
 * read a query or a body.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  claimGitHubConnectIntent,
  githubConnection,
  openGitHubConnectIntent,
} from "@luke/database/models/github-connection-store";
import { isWorkspaceMember, personalWorkspaceOf } from "@luke/database/models/workspace-store";
import type { GitHubIssueSummary, GitHubPullRequestSummary } from "@luke/features";
import { GITHUB_CONNECT_PAGE } from "@luke/features/github-connection-wire";
import {
  GITHUB_ACCESS,
  type GitHubRepositoryIssuesAnswer,
  type RepositoryIssuesAsk,
} from "@luke/features/github-repositories-wire";
import { Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import type { GitHubRepository } from "../core.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type SessionUserIdResolver,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, bodyLimit, hosted, sessionMiddleware } from "../orpc/base.js";
import { readWorkspaceSkills } from "../tasks/task-skills.js";
import { readRepositoryTree } from "../tasks/task-tree.js";
import { GitHubApp, type GitHubWorkspaceReadFailure, ISSUE_ACCESS } from "./github-app.js";
import { githubReadOrRefusal } from "./github-refusal.js";
import type { GitHubUnlink } from "./github-unlink.js";
import { issueByNumber, issuePick, openIssues, searchIssues } from "./issues.js";
import { pullRequestByNumber } from "./pull-requests.js";

/**
 * Better Auth's codes for an unlink it refused that Luke reads: a session
 * older than its freshness bound, which `unlinkAccount` asks of a session,
 * and GitHub as the account's last way to sign in.
 */
const UNLINK_REFUSAL = {
  SESSION_NOT_FRESH: "SESSION_NOT_FRESH",
  LAST_ACCOUNT: "FAILED_TO_UNLINK_LAST_ACCOUNT",
} as const;

/** An intent's id is 43 base64url characters, so a claim past this carries no intent. */
const MAXIMUM_CLAIM_BODY_BYTES = 1_024;

export interface GitHubProcedureSeams {
  resolveUserId: UserIdResolver;
  resolveSessionUserId: SessionUserIdResolver;
  /** Removes the GitHub link of the session the headers carry. */
  unlinkGitHub: GitHubUnlink;
}

/** What the procedures may require of the function that stands them. */
type GitHubRepositoriesServices = DatabaseServices | GitHubApp | HttpClient.HttpClient;

/** A repository as a read with no plan names it: the workspace whose installation reaches it, the repository, and the member asking, whose own token reaches it where no installation does. */
interface RepositoryPlace {
  readonly workspaceId: string;
  readonly repository: string;
  readonly member: string;
}

/** The place the query names, where the account is a member of its workspace; one not a member of is not found. */
const memberPlace = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  place: Omit<RepositoryPlace, "member">,
): Effect.fn.Return<RepositoryPlace, HostedRefusal, DatabaseServices> {
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, place.workspaceId));
  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return { workspaceId: place.workspaceId, repository: place.repository, member: userId };
});

/**
 * The picker's repositories: the installation's, each marked the App's,
 * and the member's own token's that no installation lists, each marked the
 * token's, as one list most recently updated first.
 */
function pickedRepositories(
  throughApp: readonly GitHubRepository[],
  onToken: readonly GitHubRepository[],
): GitHubRepository[] {
  const listed = new Set(throughApp.map((one) => one.fullName.toLowerCase()));
  const tokenOnly = onToken.filter((one) => !listed.has(one.fullName.toLowerCase()));
  return [
    ...throughApp.map((one) => ({ ...one, access: GITHUB_ACCESS.APP })),
    ...tokenOnly.map((one) => ({ ...one, access: GITHUB_ACCESS.TOKEN })),
  ].sort((left, right) => right.updatedAt - left.updatedAt);
}

/**
 * The workspace the listing is for: the one named, where the account is a
 * member of it, or the account's first one where none is named, which a
 * first read may arrive ahead of and so finds none, with nothing connected.
 */
const listedWorkspace = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  named: string | undefined,
): Effect.fn.Return<Option.Option<string>, HostedRefusal, DatabaseServices> {
  if (named === undefined) return yield* hostedStoreOrUnavailable(personalWorkspaceOf(userId));
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, named));
  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return Option.some(named);
});

/**
 * The pull request of the number given, of a repository the workspace's
 * installation reaches, as much of it as a link draws; none where the
 * installation does not reach the repository or the repository holds none
 * of that number. Note that the token is minted for the one repository and
 * dropped with the answer, because a link is read again rather than held.
 */
const pullRequestOfPlace = /* @__PURE__ */ Effect.fnUntraced(function* (
  place: RepositoryPlace,
  number: number,
): Effect.fn.Return<
  GitHubPullRequestSummary | null,
  GitHubWorkspaceReadFailure,
  GitHubRepositoriesServices
> {
  const app = yield* GitHubApp;
  const reached = yield* app.repositoryPullRequestToken(
    place.workspaceId,
    place.repository,
    place.member,
  );
  if (Option.isNone(reached)) return null;
  const found = yield* pullRequestByNumber(reached.value.token, place.repository, number);
  if (Option.isNone(found)) return null;
  const pull = found.value;
  return {
    number: pull.number,
    title: pull.title,
    url: pull.url,
    state: pull.state,
    additions: pull.additions,
    deletions: pull.deletions,
    changedFiles: pull.changedFiles,
    headRef: pull.headRef,
    ...(pull.author === undefined ? undefined : { author: pull.author }),
    ...(pull.authorAvatarUrl === undefined ? undefined : { authorAvatarUrl: pull.authorAvatarUrl }),
    ...(pull.authorBot === undefined ? undefined : { authorBot: pull.authorBot }),
    ...(pull.openedAt === undefined ? undefined : { openedAt: pull.openedAt }),
    ...(pull.mergedAt === undefined ? undefined : { mergedAt: pull.mergedAt }),
    ...(pull.closedAt === undefined ? undefined : { closedAt: pull.closedAt }),
    ...(pull.baseRef === undefined ? undefined : { baseRef: pull.baseRef }),
    ...(pull.labels === undefined ? undefined : { labels: pull.labels }),
    ...(pull.comments === undefined ? undefined : { comments: pull.comments }),
    ...(pull.commits === undefined ? undefined : { commits: pull.commits }),
  };
});

/** The issue of the number given, of a repository the workspace's installation reaches, as a link draws it; none where there is none to draw, as `pullRequestOfPlace` answers. */
const issueOfPlace = /* @__PURE__ */ Effect.fnUntraced(function* (
  place: RepositoryPlace,
  number: number,
): Effect.fn.Return<
  GitHubIssueSummary | null,
  GitHubWorkspaceReadFailure,
  GitHubRepositoriesServices
> {
  const app = yield* GitHubApp;
  const reached = yield* app.repositoryIssueToken(
    place.workspaceId,
    place.repository,
    place.member,
  );
  if (Option.isNone(reached)) return null;
  const found = yield* issueByNumber(reached.value.token, place.repository, number);
  return Option.getOrNull(found);
});

/** The issues of a repository the workspace's installation reaches, as the picker asked, or ungranted where its installation grants the App no issues. */
const issuesOfPlace = /* @__PURE__ */ Effect.fnUntraced(function* (
  place: RepositoryPlace,
  ask: RepositoryIssuesAsk,
): Effect.fn.Return<
  GitHubRepositoryIssuesAnswer,
  GitHubWorkspaceReadFailure,
  GitHubRepositoriesServices
> {
  const app = yield* GitHubApp;
  const access = yield* app.repositoryIssueAccess(
    place.workspaceId,
    place.repository,
    place.member,
  );
  if (access.kind === ISSUE_ACCESS.UNGRANTED) {
    return { ungranted: { settingsUrl: access.settingsUrl } };
  }
  if (access.kind === ISSUE_ACCESS.UNREACHED) return { issues: [] };
  const { token } = access;
  const fullName = access.repository.fullName;
  if (ask.number !== undefined) {
    return { issues: Option.toArray(yield* issuePick(token, fullName, ask.number)) };
  }
  const words = ask.query?.trim() ?? "";
  return {
    issues:
      words === ""
        ? yield* openIssues(token, fullName)
        : yield* searchIssues(token, fullName, words),
  };
});

/**
 * The session's own GitHub link removed: a session Better Auth refuses, or
 * holds too old to unlink with, is unauthenticated, which the Mac answers
 * with a fresh session from the hand-off; GitHub as the account's last way
 * to sign in is not permitted; anything else is the outage the Mac may retry.
 */
function unlinkOrRefusal(unlink: ReturnType<GitHubUnlink>): Effect.Effect<void, HostedRefusal> {
  return unlink.pipe(
    Effect.catch((failure): Effect.Effect<never, HostedRefusal> => {
      // A failure that is not a refusal is logged by its kind alone, since what it threw may quote a request.
      if (failure._tag === "UnknownError") {
        return Effect.andThen(
          Effect.logWarning("GitHub unlink failed: UnknownError"),
          Effect.fail(HOSTED_REFUSAL.UNAVAILABLE),
        );
      }
      if (
        failure.status === HOSTED_HTTP_STATUS.UNAUTHORIZED ||
        failure.code === UNLINK_REFUSAL.SESSION_NOT_FRESH
      ) {
        return Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
      }
      return Effect.fail(
        failure.code === UNLINK_REFUSAL.LAST_ACCOUNT
          ? HOSTED_REFUSAL.NOT_PERMITTED
          : HOSTED_REFUSAL.UNAVAILABLE,
      );
    }),
  );
}

/**
 * The GitHub resource: the connect intent, the connection, and the
 * repositories to the account's bearer (or the browser's cookie), the claim
 * to the browser's session, and the disconnect to the Mac's.
 */
export function githubProcedures(seams: GitHubProcedureSeams) {
  const signedIn = hosted.github.use(accountMiddleware(seams.resolveUserId));
  const inSession = hosted.github.use(sessionMiddleware(seams.resolveSessionUserId));
  return {
    connect: signedIn.connect.effect(function* ({ context }) {
      const intent = yield* hostedStoreOrUnavailable(openGitHubConnectIntent(context.userId));
      // Note that the page is on the host the Mac asked through, because the session cookie is that host's.
      const url = new URL(GITHUB_CONNECT_PAGE.PATH, context.request.url);
      url.searchParams.set(GITHUB_CONNECT_PAGE.INTENT_PARAM, intent);
      return { url: url.toString() };
    }),
    claim: inSession.use(bodyLimit(MAXIMUM_CLAIM_BODY_BYTES)).claim.effect(function* ({
      context,
      input,
    }) {
      const claim = yield* hostedStoreOrUnavailable(
        claimGitHubConnectIntent(input.intent, context.userId),
      );
      return { claim };
    }),
    connection: signedIn.connection.effect(function* ({ context }) {
      return yield* hostedStoreOrUnavailable(githubConnection(context.userId));
    }),
    disconnect: inSession.disconnect.effect(function* ({ context }) {
      yield* unlinkOrRefusal(seams.unlinkGitHub(context.sessionHeaders));
      return yield* hostedStoreOrUnavailable(githubConnection(context.userId));
    }),
    repositories: signedIn.repositories.effect(function* ({ context, input }) {
      const workspace = yield* listedWorkspace(context.userId, input.workspaceId);
      const app = yield* GitHubApp;
      const [listed, installationUrl, own] = yield* githubReadOrRefusal(
        Effect.all([
          Option.match(workspace, {
            onNone: () => Effect.succeed(Option.none<readonly GitHubRepository[]>()),
            onSome: app.workspaceRepositories,
          }),
          app.installUrl,
          app.memberRepositories(context.userId),
        ]),
      );
      return {
        installed: Option.isSome(listed),
        repositories: pickedRepositories(
          Option.getOrElse(listed, () => []),
          Option.getOrElse(own, () => []),
        ),
        installationUrl,
      };
    }),
    repositoryTree: signedIn.repositoryTree.effect(function* ({ context, input }) {
      const place = yield* memberPlace(context.userId, input);
      return yield* readRepositoryTree(place.workspaceId, place.repository, place.member, {
        path: input.path ?? "",
        ...(input.recursive === undefined ? undefined : { recursive: true }),
      });
    }),
    repositorySkills: signedIn.repositorySkills.effect(function* ({ context, input }) {
      const place = yield* memberPlace(context.userId, input);
      return yield* readWorkspaceSkills(place.workspaceId, place.repository, place.member);
    }),
    repositoryPullRequest: signedIn.repositoryPullRequest.effect(function* ({ context, input }) {
      const place = yield* memberPlace(context.userId, input);
      return { pullRequest: yield* githubReadOrRefusal(pullRequestOfPlace(place, input.number)) };
    }),
    repositoryIssue: signedIn.repositoryIssue.effect(function* ({ context, input }) {
      const place = yield* memberPlace(context.userId, input);
      return { issue: yield* githubReadOrRefusal(issueOfPlace(place, input.number)) };
    }),
    repositoryIssues: signedIn.repositoryIssues.effect(function* ({ context, input }) {
      const place = yield* memberPlace(context.userId, input);
      return yield* githubReadOrRefusal(issuesOfPlace(place, input));
    }),
  };
}
