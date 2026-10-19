import type { DatabaseServices } from "@luke/database/core/query";
import {
  type CodingAgent,
  readCodingAgent,
  readCodingAgentPublished,
  recordCodingAgentPublished,
} from "@luke/database/models/coding-agent-store";
import type { StoredPullRequest } from "@luke/database/schemas/coding-agent";
import type {
  CodingAgentPullRequest,
  CodingAgentPullRequestAnswer,
} from "@luke/features/coding-agent-wire";
import { type PullRequestArea, pullRequestAreasOf } from "@luke/features/pull-request-area";
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
  pullRequestByNumber,
  pullRequestFiles,
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
 * GitHub itself. The row keeps beside it the head it was read at, when it
 * merged, and its lines by directory, folded from its changed files
 * (`@luke/features/pull-request-area`); the files cost a read of their
 * own, so they are read again only where the pull request, its head,
 * where it stands, or its size moved since the row's, or the row keeps
 * none, and a check's delivery, which moves none of them, reads only the
 * checks; a failed read of them leaves the pull request read and the
 * areas for the next refresh. The answer is kept per
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

/** What one read found: the answer the wire carries, and the pull request as the agent's row keeps it, null where none was found. */
interface Published {
  readonly answer: CodingAgentPullRequestAnswer;
  readonly stored: StoredPullRequest | null;
}

/**
 * Whether the files the row's areas were folded from may have moved since:
 * another pull request, another head, a move of where it stands, or another
 * size. Note that the size is compared too, because the files are counted
 * against the base, which can move, or be retargeted, under a head that
 * stays.
 */
function filesMoved(kept: StoredPullRequest, found: GitHubPullRequest): boolean {
  return (
    kept.number !== found.number ||
    kept.headSha !== found.headSha ||
    kept.state !== found.state ||
    kept.additions !== found.additions ||
    kept.deletions !== found.deletions ||
    kept.changedFiles !== found.changedFiles
  );
}

/**
 * The pull request's lines by directory: the row's own where it keeps them
 * and its files cannot have moved, else folded from its files read afresh.
 * Note that the files are read within `pullRequestFiles`' bound, so a pull
 * request past it is placed by the files it reads, while its own size stays
 * GitHub's whole count. A read of the files that failed answers none rather
 * than failing the pull request beside it, and the row then keeps no areas,
 * so the next refresh reads them again.
 */
function areasOf(
  token: Redacted.Redacted,
  agent: CodingAgent,
  found: GitHubPullRequest,
  kept: StoredPullRequest | null,
): Effect.Effect<readonly PullRequestArea[] | undefined, never, HttpClient.HttpClient> {
  if (kept?.areas !== undefined && !filesMoved(kept, found)) return Effect.succeed(kept.areas);
  return pullRequestFiles(token, agent.repository, found).pipe(
    Effect.map(({ files }) =>
      pullRequestAreasOf(
        files.map(({ path, additions, deletions }) => ({ path, additions, deletions })),
      ),
    ),
    // The kind alone: nothing of the repository or the token rides the line.
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning("a pull request's files could not be read; its areas wait", {
          failure: failure._tag,
        }),
        undefined,
      ),
    ),
  );
}

/** The wire's pull request from GitHub's, with its head's checks as read. */
function wirePullRequestOf(
  found: GitHubPullRequest,
  checks: CodingAgentPullRequest["checks"],
): CodingAgentPullRequest {
  return {
    number: found.number,
    title: found.title,
    url: found.url,
    state: found.state,
    checks,
    additions: found.additions,
    deletions: found.deletions,
    changedFiles: found.changedFiles,
  };
}

/** The wire's pull request from GitHub's, with its head's checks read beside it, and the row's with its areas beside that. */
function withChecks(
  token: Redacted.Redacted,
  agent: CodingAgent,
  found: GitHubPullRequest,
  kept: StoredPullRequest | null,
): Effect.Effect<Published, PullRequestReadFailure, HttpClient.HttpClient> {
  return Effect.map(
    Effect.all(
      [checkSummaryOf(token, agent.repository, found.headSha), areasOf(token, agent, found, kept)],
      {
        concurrency: "unbounded",
      },
    ),
    ([checks, areas]) => {
      const pullRequest = wirePullRequestOf(found, checks);
      const stored: StoredPullRequest = {
        ...pullRequest,
        headSha: found.headSha,
        ...(found.mergedAt === undefined ? undefined : { mergedAt: found.mergedAt }),
        ...(areas === undefined ? undefined : { areas }),
      };
      return {
        answer: { repository: agent.repository, branch: found.headRef, pullRequest },
        stored,
      };
    },
  );
}

/** Nothing published: neither a branch GitHub holds nor a pull request. */
function nothing(agent: CodingAgent): Published {
  return {
    answer: { repository: agent.repository, branch: null, pullRequest: null },
    stored: null,
  };
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
): Effect.fn.Return<Published, PublishedReadFailure, PublishedServices> {
  // No branch on the row, no publication: no turn has ended in the sandbox, or its checkout stood detached.
  if (agent.branch === null) return nothing(agent);
  const reached = yield* agentPullRequestReach(userId, agent);
  // The default branch is the checkout's own, not a branch the agent cut: nothing published from it.
  if (agent.branch === reached.repository.defaultBranch) return nothing(agent);
  const { token } = reached;
  const ofBranch = yield* pullRequestOfBranch(token, agent.repository, agent.branch);
  if (Option.isSome(ofBranch)) {
    const kept = yield* readCodingAgentPublished(userId, agent.id);
    return yield* withChecks(token, agent, ofBranch.value, kept);
  }
  const pushed = yield* branchStands(token, agent.repository, agent.branch);
  return pushed
    ? {
        answer: { repository: agent.repository, branch: agent.branch, pullRequest: null },
        stored: null,
      }
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
  const { answer, stored } = yield* publishedOnGitHub(userId, agent);
  yield* recordCodingAgentPublished(userId, agent.id, stored);
  return answer;
});

/**
 * Another pull request of the agent's repository by its number, as GitHub
 * holds it now, with its head's checks: one the agent opened from a branch
 * it has since left, or one no agent opened, which a Pull request tab shows
 * by its number; none where the repository holds no such one. Note that it
 * is read afresh on each ask and never written on the agent's row, which
 * keeps the pull request of the branch the agent stands on.
 */
export const agentPullRequestOfNumber = /* @__PURE__ */ Effect.fn("web/agentPullRequestOfNumber")(
  function* (
    userId: string,
    agent: CodingAgent,
    number: number,
  ): Effect.fn.Return<CodingAgentPullRequestAnswer, PublishedReadFailure, PublishedServices> {
    const { token } = yield* agentPullRequestReach(userId, agent);
    const found = yield* pullRequestByNumber(token, agent.repository, number);
    if (Option.isNone(found)) return nothing(agent).answer;
    const checks = yield* checkSummaryOf(token, agent.repository, found.value.headSha);
    return {
      repository: agent.repository,
      branch: found.value.headRef,
      pullRequest: wirePullRequestOf(found.value, checks),
    };
  },
);

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
