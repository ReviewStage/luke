import type { DatabaseServices } from "@luke/database/core/query";
import {
  type CodingAgent,
  hasRepository,
  type KeptPublished,
  readCodingAgent,
  readCodingAgentKeptPublished,
  readCodingAgentPublished,
  recordCodingAgentPublished,
  type WithRepository,
} from "@luke/database/models/coding-agent-store";
import type { StoredPullRequest } from "@luke/database/schemas/coding-agent";
import { OPERATOR_NOTICE_KIND, type OperatorNoticeKind } from "@luke/database/storage-vocabulary";
import {
  type CodingAgentPullRequest,
  type CodingAgentPullRequestAnswer,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { Cache, Clock, Data, Duration, Effect, Exit, Option, type Redacted } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  GITHUB_HTTP_STATUS,
  GitHubApp,
  type GitHubRepositoryToken,
  type GitHubWorkspaceReadFailure,
} from "../../github/github-app.js";
import { pullRequestQueued } from "../../github/pull-request-merging.js";
import {
  branchStands,
  checkSummaryOf,
  type GitHubPullRequest,
  type PullRequestReadFailure,
  pullRequestByNumber,
  pullRequestOfBranch,
} from "../../github/pull-requests.js";
import { agentMember, agentWorkspace } from "../../github/workspace-repository.js";
import type { StoreFailure } from "../../http/store-failure.js";
import { settleTaskIfFinished } from "../../tasks/task-finish.js";
import { noticedForOperator } from "../operator-notice.js";
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
 * pull request's head's checks and, for an open one, whether GitHub's merge
 * queue holds it (`pull-request-merging.ts`'s `pullRequestQueued`), which the
 * REST pull request does not say. Every answer read is written on the
 * agent's row as well, the pull request or none, which is what the task
 * list reads, so the sidebar says what the last read found without asking
 * GitHub itself. The row keeps beside it the head it was read at and when
 * it merged. The answer is kept per
 * agent for `CODER.PUBLISHED_TTL` so a tab reading it beside every page of
 * a held transcript asks GitHub a few times a minute at most, under a key
 * that says whether the agent had ended, so the first read after a turn
 * ends is a fresh one rather than the running turn's kept answer; a read
 * that failed is kept for no time, so the next ask tries again. A read
 * that first finds the pull request merged, the row having kept it
 * unmerged or not at all, is one of the moments that may finish the
 * agent's task, so the task is asked to settle once the row is written
 * (`tasks/task-finish.ts`); and a read that first finds it merged or
 * closed is told the agent's member's operator as a notice
 * (`../operator-notice.ts`), the webhook's read and the token sweep's alike.
 *
 * The row also keeps when that read was and of which branch, so the kept
 * answers answer from the row rather than GitHub where it will not have
 * moved or was just read: an archived agent's, an ended agent's whose pull
 * request merged, or closed within `CODER.PUBLISHED_CLOSED_FRESH` of the
 * read, since a closed one may reopen and no sweep reads a closed one again,
 * and any read within `CODER.PUBLISHED_ROW_FRESH` of the last, on whichever
 * instance; and where GitHub refuses for its rate
 * limit, the row answers rather than a failure. The row answers only while
 * it stands on the branch read, and a change to the pull request lets the
 * read go (`forgetPublished`). Opening a task of a hundred agents once asked
 * GitHub some four hundred times at once and was refused for twenty minutes;
 * the webhook, the token sweep, the brain, and an opening still read GitHub.
 */

/** The installation of the task's workspace no longer reaches the agent's repository, so nothing of it is read. */
class RepositoryNotReachable extends Data.TaggedError("RepositoryNotReachable")<{
  readonly repository: string;
}> {}

/** What a read of what an agent published may fail with: the store, GitHub, or a repository out of reach. */
type PublishedReadFailure = StoreFailure | GitHubWorkspaceReadFailure | RepositoryNotReachable;

type PublishedServices = DatabaseServices | HttpClient.HttpClient | GitHubApp;

/** How a pull request ended: merged, or closed unmerged. */
type PullRequestEnd = typeof PULL_REQUEST_STATE.MERGED | typeof PULL_REQUEST_STATE.CLOSED;

/** What one read found: the answer the wire carries, the pull request as the agent's row keeps it, null where none was found, and how it ended where the read is the first to find it so. */
interface Published {
  readonly answer: CodingAgentPullRequestAnswer;
  readonly stored: StoredPullRequest | null;
  readonly ended: PullRequestEnd | undefined;
}

/** The wire's pull request from GitHub's, with its head's checks as read and whether the merge queue holds it. */
function wirePullRequestOf(
  found: GitHubPullRequest,
  checks: CodingAgentPullRequest["checks"],
  queued: boolean,
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
    ...(queued && found.state === PULL_REQUEST_STATE.OPEN ? { queued: true } : undefined),
  };
}

/**
 * Whether GitHub's merge queue holds the pull request, asked only of an open
 * one, since a draft, a merged, and a closed one stand in no queue. Note
 * that a read that fails keeps what the row kept of that same pull request,
 * so a queue read GitHub could not answer neither fails the read it rides
 * with nor drops a queued mark the last read saw.
 */
function queuedOf(
  token: Redacted.Redacted,
  agent: WithRepository<CodingAgent>,
  found: GitHubPullRequest,
  kept: StoredPullRequest | null,
): Effect.Effect<boolean, never, HttpClient.HttpClient> {
  if (found.state !== PULL_REQUEST_STATE.OPEN) return Effect.succeed(false);
  const keptQueued = kept !== null && kept.number === found.number && kept.queued === true;
  return pullRequestQueued(token, agent.repository, found.number).pipe(
    Effect.catch(() => Effect.succeed(keptQueued)),
  );
}

/** The wire's pull request from GitHub's, with its head's checks read beside it, and the row's with its head and when it merged beside that. */
function withChecks(
  token: Redacted.Redacted,
  agent: WithRepository<CodingAgent>,
  found: GitHubPullRequest,
  kept: StoredPullRequest | null,
): Effect.Effect<Published, PullRequestReadFailure, HttpClient.HttpClient> {
  const read = Effect.all([
    checkSummaryOf(token, agent.repository, found.headSha),
    queuedOf(token, agent, found, kept),
  ]);
  return Effect.map(read, ([checks, queued]) => {
    const pullRequest = wirePullRequestOf(found, checks, queued);
    const stored: StoredPullRequest = {
      ...pullRequest,
      headSha: found.headSha,
      ...(found.mergedAt === undefined ? undefined : { mergedAt: found.mergedAt }),
    };
    return {
      answer: { repository: agent.repository, branch: found.headRef, pullRequest },
      stored,
      ended: firstSeenEnd(found, kept),
    };
  });
}

/** How the pull request ended, where the read is the first to find it so: GitHub says merged or closed, and the row kept it otherwise, or kept none. */
function firstSeenEnd(
  found: GitHubPullRequest,
  kept: StoredPullRequest | null,
): PullRequestEnd | undefined {
  if (found.state !== PULL_REQUEST_STATE.MERGED && found.state !== PULL_REQUEST_STATE.CLOSED) {
    return undefined;
  }
  const seen = kept !== null && kept.number === found.number && kept.state === found.state;
  return seen ? undefined : found.state;
}

/** The operator's notice of each end. */
const END_NOTICE = {
  [PULL_REQUEST_STATE.MERGED]: OPERATOR_NOTICE_KIND.PR_MERGED,
  [PULL_REQUEST_STATE.CLOSED]: OPERATOR_NOTICE_KIND.PR_CLOSED,
} as const satisfies Record<PullRequestEnd, OperatorNoticeKind>;

/** Nothing published: neither a branch GitHub holds nor a pull request. */
function nothing(agent: CodingAgent): Published {
  return {
    answer: { repository: agent.repository, branch: null, pullRequest: null },
    stored: null,
    ended: undefined,
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
  agent: WithRepository<CodingAgent>,
): Effect.fn.Return<GitHubRepositoryToken, PublishedReadFailure, PublishedServices> {
  const workspace = yield* agentWorkspace(userId, agent);
  const app = yield* GitHubApp;
  const reached = Option.isNone(workspace)
    ? Option.none()
    : yield* app.repositoryPullRequestToken(workspace.value, agent.repository, agentMember(agent));
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
  // No repository, nothing to publish to.
  if (!hasRepository(agent)) return nothing(agent);
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
        ended: undefined,
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
  const { answer, stored, ended } = yield* publishedOnGitHub(userId, agent);
  const at = yield* Clock.currentTimeMillis;
  const read = { at, branch: agent.branch, pushed: answer.branch !== null };
  yield* recordCodingAgentPublished(userId, agent.id, stored, read);
  // A merge first seen may have finished the task's work; the task is asked once the row says merged.
  const merged = ended === PULL_REQUEST_STATE.MERGED;
  if (merged && agent.taskId !== null) yield* settleTaskIfFinished(userId, agent.taskId);
  // An end first seen is told the agent's member's operator, whoever's read saw it.
  if (ended !== undefined) yield* noticedForOperator(agent.id, END_NOTICE[ended]);
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
    if (!hasRepository(agent)) return nothing(agent).answer;
    const { token } = yield* agentPullRequestReach(userId, agent);
    const found = yield* pullRequestByNumber(token, agent.repository, number);
    if (Option.isNone(found)) return nothing(agent).answer;
    const checks = yield* checkSummaryOf(token, agent.repository, found.value.headSha);
    const queued = yield* queuedOf(token, agent, found.value, null);
    return {
      repository: agent.repository,
      branch: found.value.headRef,
      pullRequest: wirePullRequestOf(found.value, checks, queued),
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

/** The answer the row keeps, as the read that wrote it answered: its pull request as the wire carries it, else the branch where GitHub held it. */
function keptAnswer(agent: CodingAgent, kept: KeptPublished): CodingAgentPullRequestAnswer {
  if (kept.published === null) {
    const branch = kept.read.pushed ? kept.read.branch : null;
    return { repository: agent.repository, branch, pullRequest: null };
  }
  const { headSha: _headSha, mergedAt: _mergedAt, ...pullRequest } = kept.published;
  return { repository: agent.repository, branch: kept.read.branch, pullRequest };
}

/** Whether the row answers in GitHub's place: the agent archived, or ended on a pull request that merged or closed a while ago at most, or the row read a moment ago. */
function keptStands(agent: CodingAgent, ended: boolean, kept: KeptPublished, now: number): boolean {
  if (agent.archivedAt !== null) return true;
  const state = kept.published?.state;
  const age = now - kept.read.at;
  if (ended && state === PULL_REQUEST_STATE.MERGED) return true;
  if (ended && state === PULL_REQUEST_STATE.CLOSED) {
    return age < Duration.toMillis(CODER.PUBLISHED_CLOSED_FRESH);
  }
  return age < Duration.toMillis(CODER.PUBLISHED_ROW_FRESH);
}

/** Whether GitHub refused the read for its rate limit: a 429, the instance's own held answer among them, or a 403 it may answer one with. */
function rateLimited(failure: PublishedReadFailure): boolean {
  if (failure._tag !== "GitHubUnavailable") return false;
  return (
    failure.status === GITHUB_HTTP_STATUS.TOO_MANY_REQUESTS ||
    failure.status === GITHUB_HTTP_STATUS.FORBIDDEN
  );
}

/**
 * One agent's answer looked up afresh: the row, then what it keeps where
 * that answers in GitHub's place, else what GitHub holds now, the row again
 * where GitHub refused for its rate limit. A row that stands on another
 * branch than the one read keeps nothing of it.
 */
const lookupPublished = (
  key: PublishedKey,
): Effect.Effect<
  CodingAgentPullRequestAnswer,
  PublishedReadFailure | NoSuchAgent,
  PublishedServices
> =>
  Effect.gen(function* () {
    const found = yield* readCodingAgent(key.userId, key.agentId);
    if (Option.isNone(found)) return yield* new NoSuchAgent({ agentId: key.agentId });
    const agent = found.value;
    const row = yield* readCodingAgentKeptPublished(key.userId, agent.id);
    const kept = row !== null && row.read.branch === agent.branch ? row : null;
    const now = yield* Clock.currentTimeMillis;
    if (kept !== null && keptStands(agent, key.ended, kept, now)) return keptAnswer(agent, kept);
    return yield* agentPublished(key.userId, agent).pipe(
      Effect.catch((failure) =>
        kept !== null && rateLimited(failure)
          ? Effect.succeed(keptAnswer(agent, kept))
          : Effect.fail(failure),
      ),
    );
  });

/** The cache, made once per instance by `instancePublishedCache`. */
const publishedCache: Effect.Effect<PublishedCache> = Cache.makeWith(lookupPublished, {
  capacity: KEPT_AGENTS,
  requireServicesAt: "lookup",
  timeToLive: (exit) => (Exit.isSuccess(exit) ? CODER.PUBLISHED_TTL : Duration.zero),
});

/**
 * A cache of its own for procedures that are built with no Effect to build
 * one in: made on the first ask and kept for the instance's life, as a
 * route group's is. Note that two first asks at once each make one and the
 * first to land is the one kept, so every later ask shares it. The hosted
 * router makes one and hands it to every resource that reads the kept
 * answers or lets them go (`PublishedReach`), so a change to a pull request
 * lets go of what each of them read.
 */
export function instancePublishedCache(): Effect.Effect<PublishedCache> {
  let kept: PublishedCache | undefined;
  return Effect.suspend(() =>
    kept === undefined
      ? Effect.map(publishedCache, (made) => (kept ??= made))
      : Effect.succeed(kept),
  );
}

/** The kept published answers a resource's procedures read and let go of: the instance's one cache where the router hands it, one of their own otherwise. */
export interface PublishedReach {
  readonly published?: Effect.Effect<PublishedCache>;
}
