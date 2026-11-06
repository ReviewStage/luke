import type { DatabaseServices } from "@repo/database/core/query";
import {
  claimGitHubConnectIntent,
  githubConnection,
  openGitHubConnectIntent,
} from "@repo/database/models/github-connection-store";
import {
  isWorkspaceMember,
  personalWorkspaceOf,
  workspaceOf,
} from "@repo/database/models/workspace-store";
import {
  addWorkspaceTokenRepository,
  listWorkspaceTokenRepositories,
  removeWorkspaceTokenRepository,
  type WorkspaceTokenRepositoryRow,
  workspaceTokenRepositoryAdder,
} from "@repo/database/models/workspace-token-repository-store";
import type { GitHubIssueSummary } from "@repo/features";
import { GITHUB_CONNECT_PAGE } from "@repo/features/github-connection-wire";
import {
  GITHUB_ACCESS,
  type WorkspaceTokenRepositoriesAnswer,
} from "@repo/features/github-repositories-wire";
import { managesWorkspace } from "@repo/features/workspace-role";
import { DateTime, Effect, Option, Result } from "effect";
import type { HttpClient } from "effect/http";
import type { GitHubRepository } from "../core.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  repositoryNotReachable,
  type SessionUserIdResolver,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted, sessionMiddleware } from "../orpc/base.js";
import { readRepositoryFileWindow } from "../tasks/task-file.js";
import { fileWindowOf } from "../tasks/task-files-procedures.js";
import { readWorkspaceSkills } from "../tasks/task-skills.js";
import { readRepositoryTree } from "../tasks/task-tree.js";
import {
  GitHubApp,
  type GitHubWorkspaceReadFailure,
  markRefusedToken,
  type WorkspaceListing,
} from "./github-app.js";
import {
  githubReachOrRefusal,
  githubReadOrRefusal,
  logWorkspaceReadFailure,
} from "./github-refusal.js";
import type { GitHubUnlink } from "./github-unlink.js";
import { issueByNumber } from "./issues.js";
import { PullRequestLinkKey, PullRequestLinks } from "./pull-request-links.js";

const UNLINK_REFUSAL = {
  SESSION_NOT_FRESH: "SESSION_NOT_FRESH",
  LAST_ACCOUNT: "FAILED_TO_UNLINK_LAST_ACCOUNT",
} as const;

export interface GitHubProcedureSeams {
  resolveUserId: UserIdResolver;
  resolveSessionUserId: SessionUserIdResolver;
  unlinkGitHub: GitHubUnlink;
}

type GitHubRepositoriesServices = DatabaseServices | GitHubApp | HttpClient.HttpClient;

interface RepositoryPlace {
  readonly workspaceId: string;
  readonly repository: string;
  readonly member: string;
}

export const memberPlace = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  place: Omit<RepositoryPlace, "member">,
): Effect.fn.Return<RepositoryPlace, HostedRefusal, DatabaseServices> {
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, place.workspaceId));
  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return { workspaceId: place.workspaceId, repository: place.repository, member: userId };
});

function nameKey(fullName: string): string {
  return fullName.toLowerCase();
}

interface PickedRepositories {
  readonly repositories: GitHubRepository[];
  readonly addable: GitHubRepository[];
}

function pickedRepositories(
  throughApp: readonly GitHubRepository[],
  onToken: readonly GitHubRepository[],
  added: readonly WorkspaceTokenRepositoryRow[],
): PickedRepositories {
  const listed = new Set(throughApp.map((one) => nameKey(one.fullName)));
  const ownByName = new Map(onToken.map((one) => [nameKey(one.fullName), one]));
  const addedOnly = added.flatMap((row) => {
    const key = nameKey(row.repository);
    const own = ownByName.get(key);
    return listed.has(key) || own === undefined ? [] : [own];
  });
  for (const one of addedOnly) listed.add(nameKey(one.fullName));
  const byRecent = (left: GitHubRepository, right: GitHubRepository) =>
    right.updatedAt - left.updatedAt;
  return {
    repositories: [
      ...throughApp.map((one) => ({ ...one, access: GITHUB_ACCESS.APP })),
      ...addedOnly.map((one) => ({ ...one, access: GITHUB_ACCESS.TOKEN })),
    ].sort(byRecent),
    addable: onToken
      .filter((one) => !listed.has(nameKey(one.fullName)))
      .map((one) => ({ ...one, access: GITHUB_ACCESS.TOKEN }))
      .sort(byRecent),
  };
}

const tokenRepositoriesOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<WorkspaceTokenRepositoriesAnswer, HostedRefusal, GitHubRepositoriesServices> {
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, workspaceId));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const rows = yield* hostedStoreOrUnavailable(listWorkspaceTokenRepositories(userId, workspaceId));
  if (rows.length === 0) return { repositories: [] };
  const app = yield* GitHubApp;
  const throughApp = yield* app.workspaceRepositories(workspaceId).pipe(
    Effect.tapError(logWorkspaceReadFailure),
    Effect.catch((failure) =>
      failure._tag === "GitHubAppNotConfigured" || failure._tag === "GitHubUnavailable"
        ? Effect.succeed(Option.none<readonly GitHubRepository[]>())
        : Effect.fail(HOSTED_REFUSAL.UNAVAILABLE),
    ),
  );
  const reached = new Set(
    Option.getOrElse(throughApp, () => []).map((one) => nameKey(one.fullName)),
  );
  const manages = managesWorkspace(workspace.value);
  return {
    repositories: rows
      .filter((row) => !reached.has(nameKey(row.repository)))
      .map((row) => ({
        fullName: row.repository,
        addedBy: row.addedByUserId,
        addedAt: row.addedAt,
        removable: manages || row.addedByUserId === userId,
      })),
  };
});

const addTokenRepository = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  repository: string,
): Effect.fn.Return<void, HostedRefusal, GitHubRepositoriesServices> {
  const app = yield* GitHubApp;
  const reach = yield* githubReachOrRefusal(app.repositoryReach(workspaceId, repository, userId));
  if (Result.isFailure(reach)) return yield* Effect.fail(repositoryNotReachable(reach.failure));
  if (reach.success.access !== GITHUB_ACCESS.TOKEN) return;
  const now = yield* DateTime.nowAsDate;
  yield* hostedStoreOrUnavailable(
    addWorkspaceTokenRepository(userId, workspaceId, reach.success.repository.fullName, now),
  );
});

const removeTokenRepository = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  repository: string,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices> {
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, workspaceId));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const adder = yield* hostedStoreOrUnavailable(
    workspaceTokenRepositoryAdder(userId, workspaceId, repository),
  );
  if (Option.isNone(adder)) return;
  if (adder.value !== userId && !managesWorkspace(workspace.value)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }
  yield* hostedStoreOrUnavailable(
    removeWorkspaceTokenRepository(userId, workspaceId, repository, adder.value),
  );
});

const listedWorkspace = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  named: string | undefined,
): Effect.fn.Return<Option.Option<string>, HostedRefusal, DatabaseServices> {
  if (named === undefined) return yield* hostedStoreOrUnavailable(personalWorkspaceOf(userId));
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, named));
  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return Option.some(named);
});

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
  const found = yield* issueByNumber(reached.value.token, place.repository, number).pipe(
    markRefusedToken(reached.value.access),
  );
  return Option.getOrNull(found);
});

function unlinkOrRefusal(unlink: ReturnType<GitHubUnlink>): Effect.Effect<void, HostedRefusal> {
  return unlink.pipe(
    Effect.catch((failure): Effect.Effect<never, HostedRefusal> => {
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

export function githubProcedures(seams: GitHubProcedureSeams) {
  const signedIn = hosted.github.use(accountMiddleware(seams.resolveUserId));
  const inSession = hosted.github.use(sessionMiddleware(seams.resolveSessionUserId));
  return {
    connect: signedIn.connect.effect(function* ({ context }) {
      const intent = yield* hostedStoreOrUnavailable(openGitHubConnectIntent(context.userId));
      const url = new URL(GITHUB_CONNECT_PAGE.PATH, context.request.url);
      url.searchParams.set(GITHUB_CONNECT_PAGE.INTENT_PARAM, intent);
      return { url: url.toString() };
    }),
    claim: inSession.claim.effect(function* ({ context, input }) {
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
            onNone: () => Effect.succeed(Option.none<WorkspaceListing>()),
            onSome: app.workspaceListing,
          }),
          app.installUrl,
          app.memberRepositories(context.userId),
        ]),
      );
      const added = Option.isNone(workspace)
        ? []
        : yield* hostedStoreOrUnavailable(
            listWorkspaceTokenRepositories(context.userId, workspace.value),
          );
      return {
        installed: Option.isSome(listed),
        ...pickedRepositories(
          Option.match(listed, { onNone: () => [], onSome: (listing) => listing.repositories }),
          Option.getOrElse(own, () => []),
          added,
        ),
        installations: Option.match(listed, {
          onNone: () => [],
          onSome: (listing) => listing.installations,
        }),
        installationUrl,
      };
    }),
    tokenRepositories: signedIn.tokenRepositories.effect(function* ({ context, input }) {
      return yield* tokenRepositoriesOf(context.userId, input.workspaceId);
    }),
    setTokenRepository: signedIn.setTokenRepository.effect(function* ({ context, input }) {
      const member = yield* hostedStoreOrUnavailable(
        isWorkspaceMember(context.userId, input.workspaceId),
      );
      if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      yield* input.added
        ? addTokenRepository(context.userId, input.workspaceId, input.repository)
        : removeTokenRepository(context.userId, input.workspaceId, input.repository);
      return yield* tokenRepositoriesOf(context.userId, input.workspaceId);
    }),
    repositoryFile: signedIn.repositoryFile.effect(function* ({ context, input }) {
      const place = yield* memberPlace(context.userId, input);
      const window = yield* fileWindowOf(input);
      return yield* readRepositoryFileWindow(
        place.workspaceId,
        place.repository,
        place.member,
        window,
      );
    }),
    repositoryTree: signedIn.repositoryTree.effect(function* ({ context, input }) {
      const place = yield* memberPlace(context.userId, input);
      return yield* readRepositoryTree(place.workspaceId, place.repository, place.member, {
        path: input.path ?? "",
        ...(input.recursive === undefined ? undefined : { recursive: true }),
      });
    }),
    repositorySkills: signedIn.repositorySkills.effect(function* ({ context, input }) {
      const member = yield* hostedStoreOrUnavailable(
        isWorkspaceMember(context.userId, input.workspaceId),
      );
      if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return yield* hostedStoreOrUnavailable(
        readWorkspaceSkills(
          input.workspaceId,
          input.repository ?? null,
          context.userId,
          input.installed !== undefined,
        ),
      );
    }),
    repositoryPullRequest: signedIn.repositoryPullRequest.effect(function* ({ context, input }) {
      const place = yield* memberPlace(context.userId, input);
      const links = yield* PullRequestLinks;
      const pullRequest = yield* links
        .read(new PullRequestLinkKey({ ...place, number: input.number }))
        .pipe(Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE));
      return { pullRequest };
    }),
    repositoryIssue: signedIn.repositoryIssue.effect(function* ({ context, input }) {
      const place = yield* memberPlace(context.userId, input);
      return { issue: yield* githubReadOrRefusal(issueOfPlace(place, input.number)) };
    }),
  };
}
