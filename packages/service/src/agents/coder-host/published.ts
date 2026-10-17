import type { DatabaseServices } from "@luke/database/core/query";
import {
  type CodingAgent,
  readCodingAgent,
  recordCodingAgentPublished,
} from "@luke/database/models/coding-agent-store";
import type {
  CodingAgentPullRequest,
  CodingAgentPullRequestAnswer,
} from "@luke/features/coding-agent-wire";
import { Cache, Data, Duration, Effect, Exit, type Layer, Option, type Redacted } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  GitHubApp,
  type GitHubRepositoryToken,
  type GitHubWorkspaceReadFailure,
} from "../../github/github-app.js";
import {
  branchStands,
  checkSummaryOf,
  type GitHubPullRequest,
  type PullRequestReadFailure,
  pullRequestOfBranch,
} from "../../github/pull-requests.js";
import { agentWorkspace } from "../../github/workspace-repository.js";
import type { StoreFailure } from "../../http/store-failure.js";
import { CODER } from "./bounds.js";

/**
 * published.ts -- what a coding agent published: the branch its sandbox stands on and the pull request from it, confirmed on GitHub.
 *
 * The agent reaches GitHub through `git` and `gh` in its shell alone, and
 * the branch it is on as a turn ends is the one its pull request is on,
 * whatever it cut, switched, or deleted on the way: the session's turn-end
 * hook reads that branch off the checkout and writes it on the agent's row
 * (`coder-host/host.ts`'s `recordBranch`), and this module reads the row.
 * A row with no branch, as before the first turn ends in the sandbox or
 * where the checkout stood detached, published nothing, and GitHub is not
 * asked. GitHub then says what stands, once the installation of the task's
 * workspace is confirmed to reach the repository as a Start confirms it,
 * on a token minted for that one repository with pull requests read: a row
 * still on the repository's default branch, as an agent that only read
 * leaves it, published nothing either; otherwise the newest pull request
 * from the branch, else whether the branch was pushed at all, with the
 * pull request's head's checks. Every answer read is written on the
 * agent's row as well, the pull request or none, which is what the task
 * list reads, so the sidebar says what the last read found without asking
 * GitHub itself. The answer is kept per
 * agent for `CODER.PUBLISHED_TTL` so a tab reading it beside every page of
 * a held transcript asks GitHub a few times a minute at most, under a key
 * that says whether the agent had ended, so the first read after a turn
 * ends is a fresh one rather than the running turn's kept answer; a read
 * that failed is kept for no time, so the next ask tries again.
 */

/** The installation of the task's workspace no longer reaches the agent's repository, so nothing of it is read. */
class RepositoryNotReachable extends Data.TaggedError("RepositoryNotReachable")<{
  readonly repository: string;
}> {}

/** What a read of what an agent published may fail with: the store, GitHub, or a repository out of reach. */
type PublishedReadFailure = StoreFailure | GitHubWorkspaceReadFailure | RepositoryNotReachable;

type PublishedServices = DatabaseServices | HttpClient.HttpClient | GitHubApp;

/** The wire's pull request from GitHub's, with its head's checks read beside it. */
function withChecks(
  token: Redacted.Redacted,
  agent: CodingAgent,
  found: GitHubPullRequest,
): Effect.Effect<CodingAgentPullRequestAnswer, PullRequestReadFailure, HttpClient.HttpClient> {
  return Effect.map(checkSummaryOf(token, agent.repository, found.headSha), (checks) => {
    const pullRequest: CodingAgentPullRequest = {
      number: found.number,
      title: found.title,
      url: found.url,
      state: found.state,
      checks,
      additions: found.additions,
      deletions: found.deletions,
      changedFiles: found.changedFiles,
    };
    return { repository: agent.repository, branch: found.headRef, pullRequest };
  });
}

/** Nothing published: neither a branch GitHub holds nor a pull request. */
function nothing(agent: CodingAgent): CodingAgentPullRequestAnswer {
  return { repository: agent.repository, branch: null, pullRequest: null };
}

/**
 * A token that reads the agent's pull requests, minted for its one
 * repository on the installation of its task's workspace, as the account
 * asking reaches the task; refused as out of reach where either no longer
 * stands.
 */
export const agentPullRequestReach = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: CodingAgent,
): Effect.fn.Return<GitHubRepositoryToken, PublishedReadFailure, PublishedServices> {
  const workspace = yield* agentWorkspace(userId, agent);
  const app = yield* GitHubApp;
  const reached = Option.isNone(workspace)
    ? Option.none()
    : yield* app.repositoryPullRequestToken(workspace.value, agent.repository);
  if (Option.isNone(reached)) {
    return yield* new RepositoryNotReachable({ repository: agent.repository });
  }
  return reached.value;
});

/**
 * What the agent published as GitHub holds it now: the newest pull request
 * from the branch its row holds, else the branch alone where GitHub holds
 * it, else nothing.
 */
const publishedOnGitHub = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: CodingAgent,
): Effect.fn.Return<CodingAgentPullRequestAnswer, PublishedReadFailure, PublishedServices> {
  // No branch on the row, no publication: no turn has ended in the sandbox, or its checkout stood detached.
  if (agent.branch === null) return nothing(agent);
  const reached = yield* agentPullRequestReach(userId, agent);
  // The default branch is the checkout's own, not a branch the agent cut: nothing published from it.
  if (agent.branch === reached.repository.defaultBranch) return nothing(agent);
  const { token } = reached;
  const ofBranch = yield* pullRequestOfBranch(token, agent.repository, agent.branch);
  if (Option.isSome(ofBranch)) return yield* withChecks(token, agent, ofBranch.value);
  const pushed = yield* branchStands(token, agent.repository, agent.branch);
  return pushed
    ? { repository: agent.repository, branch: agent.branch, pullRequest: null }
    : nothing(agent);
});

/**
 * What the agent published as GitHub holds it now, written on its row as
 * read. The routes read it through the cache below; the voice brain's read
 * of one agent (`agents/coding-agent-tools.ts`) reads it afresh, once per
 * ask.
 */
export const agentPublished = /* @__PURE__ */ Effect.fn("web/agentPublished")(function* (
  userId: string,
  agent: CodingAgent,
): Effect.fn.Return<CodingAgentPullRequestAnswer, PublishedReadFailure, PublishedServices> {
  const answer = yield* publishedOnGitHub(userId, agent);
  yield* recordCodingAgentPublished(userId, agent.id, answer.pullRequest);
  return answer;
});

/** One agent of one account, as the kept answers are keyed, and whether it had ended as asked: the first ask after a turn ends is its own key, so it reads afresh. */
export class PublishedKey extends Data.Class<{
  readonly userId: string;
  readonly agentId: string;
  readonly ended: boolean;
}> {}

/** The kept answers of one function instance: an agent's answer for the TTL, a failure for no time. */
export type PublishedCache = Cache.Cache<
  PublishedKey,
  CodingAgentPullRequestAnswer,
  PublishedReadFailure | NoSuchAgent,
  PublishedServices
>;

/** The key names an agent the account does not hold, which an ownership check before the ask already refused. */
class NoSuchAgent extends Data.TaggedError("NoSuchAgent")<{ readonly agentId: string }> {}

/** The most agents one instance keeps answers for at once. */
const KEPT_AGENTS = 1_024;

/** One agent's answer looked up afresh: the row, then what it published. */
const lookupPublished = (
  key: PublishedKey,
): Effect.Effect<
  CodingAgentPullRequestAnswer,
  PublishedReadFailure | NoSuchAgent,
  PublishedServices
> =>
  Effect.gen(function* () {
    const agent = yield* readCodingAgent(key.userId, key.agentId);
    if (Option.isNone(agent)) return yield* new NoSuchAgent({ agentId: key.agentId });
    return yield* agentPublished(key.userId, agent.value);
  });

/** The cache, built once where the routes are composed. */
const publishedCache: Effect.Effect<PublishedCache> = Cache.makeWith(lookupPublished, {
  capacity: KEPT_AGENTS,
  requireServicesAt: "lookup",
  timeToLive: (exit) => (Exit.isSuccess(exit) ? CODER.PUBLISHED_TTL : Duration.zero),
});

/** The routes composed over a cache of their own. */
export function withPublishedCache<A, E, R>(
  routes: (cache: PublishedCache) => Layer.Layer<A, E, R>,
): Effect.Effect<Layer.Layer<A, E, R>> {
  return Effect.map(publishedCache, routes);
}
