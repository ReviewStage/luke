import type { DatabaseServices } from "@repo/database/core/query";
import type { GitHubPullRequestSummary } from "@repo/features";
import { PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { Cache, Context, Data, Duration, Effect, Exit, Layer, Option } from "effect";
import type { HttpClient } from "effect/http";
import {
  GITHUB_HTTP_STATUS,
  GitHubApp,
  GitHubUnavailable,
  type GitHubWorkspaceReadFailure,
  markRefusedToken,
} from "./github-app.js";
import { logWorkspaceReadFailure } from "./github-refusal.js";
import { pullRequestQueued } from "./pull-request-merging.js";
import { pullRequestByNumber } from "./pull-requests.js";

export const KEPT_LINK = {
  CAPACITY: 2_048,
  ANSWER_TTL: Duration.minutes(1),
  REFUSAL_HOLD: Duration.minutes(3),
  REFUSAL_HOLD_MAX: Duration.minutes(15),
} as const;

type LinkServices = DatabaseServices | GitHubApp | HttpClient.HttpClient;

export class PullRequestLinkKey extends Data.Class<{
  readonly workspaceId: string;
  readonly repository: string;
  readonly member: string;
  readonly number: number;
}> {}

function keptFor(exit: Exit.Exit<unknown, GitHubWorkspaceReadFailure>): Duration.Duration {
  if (Exit.isSuccess(exit)) return KEPT_LINK.ANSWER_TTL;
  const failure = Option.getOrUndefined(Exit.findErrorOption(exit));
  if (!(failure instanceof GitHubUnavailable)) return Duration.zero;
  const refused =
    failure.status === GITHUB_HTTP_STATUS.FORBIDDEN ||
    failure.status === GITHUB_HTTP_STATUS.TOO_MANY_REQUESTS;
  if (!refused) return Duration.zero;
  return Duration.min(failure.retryAfter ?? KEPT_LINK.REFUSAL_HOLD, KEPT_LINK.REFUSAL_HOLD_MAX);
}

const pullRequestOfLink = /* @__PURE__ */ Effect.fnUntraced(function* (
  key: PullRequestLinkKey,
): Effect.fn.Return<GitHubPullRequestSummary | null, GitHubWorkspaceReadFailure, LinkServices> {
  const app = yield* GitHubApp;
  const reached = yield* app.repositoryPullRequestToken(
    key.workspaceId,
    key.repository,
    key.member,
  );
  if (Option.isNone(reached)) return null;
  const found = yield* pullRequestByNumber(reached.value.token, key.repository, key.number).pipe(
    markRefusedToken(reached.value.access),
  );
  if (Option.isNone(found)) return null;
  const pull = found.value;
  const queued =
    pull.state === PULL_REQUEST_STATE.OPEN &&
    (yield* pullRequestQueued(reached.value.token, key.repository, key.number).pipe(
      Effect.catch(() => Effect.succeed(false)),
    ));
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
    ...(queued ? { queued: true } : undefined),
  };
});

export class PullRequestLinks extends Context.Service<
  PullRequestLinks,
  {
    readonly read: (
      key: PullRequestLinkKey,
    ) => Effect.Effect<GitHubPullRequestSummary | null, GitHubWorkspaceReadFailure, LinkServices>;
  }
>()("PullRequestLinks") {}

export const pullRequestLinksLayer: Layer.Layer<PullRequestLinks> = Layer.effect(
  PullRequestLinks,
  Effect.gen(function* () {
    const kept = yield* Cache.makeWith(
      (key: PullRequestLinkKey) =>
        pullRequestOfLink(key).pipe(Effect.tapError(logWorkspaceReadFailure)),
      { capacity: KEPT_LINK.CAPACITY, requireServicesAt: "lookup", timeToLive: keptFor },
    );
    return {
      read: (key) =>
        Effect.gen(function* () {
          yield* Cache.getOption(kept, key);
          const app = yield* GitHubApp;
          const reached = yield* app
            .repositoryPullRequestToken(key.workspaceId, key.repository, key.member)
            .pipe(Effect.tapError(logWorkspaceReadFailure));
          if (Option.isNone(reached)) return null;
          return yield* Cache.get(kept, key);
        }),
    };
  }),
);
