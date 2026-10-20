/**
 * pull-request-links.ts -- the pull request a link draws, read once a minute per instance rather than once per link.
 *
 * A screen of plans and chat draws every pull request link as a chip, and
 * each chip asks `GET /api/github/repositories/pull-request` as it mounts,
 * so one desktop asks for the same pull request in bursts. Each ask read
 * the installation, minted or found a token, and read GitHub, and a burst
 * of them is what GitHub's secondary rate limit answers 403 to.
 *
 * So the answer is kept on the instance, per pull request as one member
 * asked for it: concurrent asks join the one read under way, an answer is
 * kept for `KEPT_LINK.ANSWER_TTL`, and a refusal GitHub answers 403 or 429
 * is held for as long as its `Retry-After` asks, or `KEPT_LINK.REFUSAL_HOLD`
 * where it names none, never past `KEPT_LINK.REFUSAL_HOLD_MAX`, so the asks
 * that follow a refusal are answered with it rather than sent. Any other
 * failure is not kept, so the next ask reads afresh. A failure is logged
 * where it is read, once per read rather than once per ask it answers.
 *
 * Note that the member is part of the key, because a repository no
 * installation reaches may be read on the member's own token, and what that
 * token reads is not another member's to see. Who may ask at all is checked
 * on every ask, before the kept answer is read.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import type { GitHubPullRequestSummary } from "@luke/features";
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
import { pullRequestByNumber } from "./pull-requests.js";

/** How many links an instance keeps, and for how long an answer and a refusal are kept. */
export const KEPT_LINK = {
  CAPACITY: 2_048,
  ANSWER_TTL: Duration.minutes(1),
  REFUSAL_HOLD: Duration.minutes(3),
  REFUSAL_HOLD_MAX: Duration.minutes(15),
} as const;

/** What a read of a link may require of the function that stands it. */
type LinkServices = DatabaseServices | GitHubApp | HttpClient.HttpClient;

/** One pull request of one repository of one workspace, as one member asked for it. */
export class PullRequestLinkKey extends Data.Class<{
  readonly workspaceId: string;
  readonly repository: string;
  readonly member: string;
  readonly number: number;
}> {}

/** How long a read's outcome is kept: an answer a minute, GitHub's refusal as long as it asked, anything else not at all. */
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

/**
 * The pull request of the number given, of a repository the workspace's
 * installation or the member's own token reaches, as much of it as a link
 * draws; none where neither reaches the repository or the repository holds
 * none of that number.
 */
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

/** The pull requests links draw, kept on the instance on the terms above. */
export class PullRequestLinks extends Context.Service<
  PullRequestLinks,
  {
    /** The pull request the key names, kept or read; a failure is logged where it was read, not here. */
    readonly read: (
      key: PullRequestLinkKey,
    ) => Effect.Effect<GitHubPullRequestSummary | null, GitHubWorkspaceReadFailure, LinkServices>;
  }
>()("PullRequestLinks") {}

/** The instance's kept links, empty at the start. */
export const pullRequestLinksLayer: Layer.Layer<PullRequestLinks> = Layer.effect(
  PullRequestLinks,
  Effect.gen(function* () {
    const kept = yield* Cache.makeWith(
      (key: PullRequestLinkKey) =>
        pullRequestOfLink(key).pipe(Effect.tapError(logWorkspaceReadFailure)),
      { capacity: KEPT_LINK.CAPACITY, requireServicesAt: "lookup", timeToLive: keptFor },
    );
    return { read: (key) => Cache.get(kept, key) };
  }),
);
