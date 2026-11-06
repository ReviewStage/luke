import type { DatabaseServices } from "@repo/database/core/query";
import {
  type AgentRepositoryEntry,
  readAgentRepositories,
  recordAgentRepositoryPublished,
} from "@repo/database/models/agent-repositories";
import {
  type Agent,
  hasRepository,
  type KeptPublished,
  readAgent,
  readAgentKeptPublished,
  readAgentPublished,
  recordAgentPublished,
  type WithRepository,
} from "@repo/database/models/agent-store";
import type { StoredPullRequest } from "@repo/database/schemas/agent";
import {
  type AgentPullRequest,
  type AgentPullRequestAnswer,
  PULL_REQUEST_STATE,
  pullRequestAuthorOf,
} from "@repo/features/agent-wire";
import { failureKind } from "@repo/runtime/effect";
import { Cache, Clock, Data, Duration, Effect, Exit, Option, type Redacted } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { recordServerEvent, SERVER_EVENT } from "../../events/server-events.js";
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
import { CODER } from "./bounds.js";

class RepositoryNotReachable extends Data.TaggedError("RepositoryNotReachable")<{
  readonly repository: string;
}> {}

type PublishedReadFailure = StoreFailure | GitHubWorkspaceReadFailure | RepositoryNotReachable;

type PublishedServices = DatabaseServices | HttpClient.HttpClient | GitHubApp;

type PullRequestEnd = typeof PULL_REQUEST_STATE.MERGED | typeof PULL_REQUEST_STATE.CLOSED;

interface Published {
  readonly answer: AgentPullRequestAnswer;
  readonly stored: StoredPullRequest | null;
  readonly ended: PullRequestEnd | undefined;
}

function wirePullRequestOf(
  found: GitHubPullRequest,
  checks: AgentPullRequest["checks"],
  queued: boolean,
): AgentPullRequest {
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
    ...pullRequestAuthorOf(found),
  };
}

function queuedOf(
  token: Redacted.Redacted,
  repository: string,
  found: GitHubPullRequest,
  kept: StoredPullRequest | null,
): Effect.Effect<boolean, never, HttpClient.HttpClient> {
  if (found.state !== PULL_REQUEST_STATE.OPEN) return Effect.succeed(false);
  const keptQueued = kept !== null && kept.number === found.number && kept.queued === true;
  return pullRequestQueued(token, repository, found.number).pipe(
    Effect.catch(() => Effect.succeed(keptQueued)),
  );
}

function withChecks(
  token: Redacted.Redacted,
  repository: string,
  found: GitHubPullRequest,
  kept: StoredPullRequest | null,
): Effect.Effect<Published, PullRequestReadFailure, HttpClient.HttpClient> {
  const read = Effect.all([
    checkSummaryOf(token, repository, found.headSha),
    queuedOf(token, repository, found, kept),
  ]);
  return Effect.map(read, ([checks, queued]) => {
    const pullRequest = wirePullRequestOf(found, checks, queued);
    const stored: StoredPullRequest = {
      ...pullRequest,
      headSha: found.headSha,
      ...(found.mergedAt === undefined ? undefined : { mergedAt: found.mergedAt }),
    };
    return {
      answer: { repository, branch: found.headRef, pullRequest },
      stored,
      ended: firstSeenEnd(found, kept),
    };
  });
}

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

function nothing(agent: Agent): Published {
  return {
    answer: { repository: agent.repository, branch: null, pullRequest: null },
    stored: null,
    ended: undefined,
  };
}

export const agentPullRequestReach = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: WithRepository<Agent>,
  repository: string = agent.repository,
): Effect.fn.Return<GitHubRepositoryToken, PublishedReadFailure, PublishedServices> {
  const workspace = yield* agentWorkspace(userId, agent);
  const app = yield* GitHubApp;
  const reached = Option.isNone(workspace)
    ? Option.none()
    : yield* app.repositoryPullRequestToken(workspace.value, repository, agentMember(agent));
  if (Option.isNone(reached)) {
    return yield* new RepositoryNotReachable({ repository });
  }
  return reached.value;
});

const publishedOnGitHub = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: Agent,
): Effect.fn.Return<Published, PublishedReadFailure, PublishedServices> {
  if (agent.branch === null) return nothing(agent);
  if (!hasRepository(agent)) return nothing(agent);
  const reached = yield* agentPullRequestReach(userId, agent);
  if (agent.branch === reached.repository.defaultBranch) return nothing(agent);
  const { token } = reached;
  const ofBranch = yield* pullRequestOfBranch(token, agent.repository, agent.branch);
  if (Option.isSome(ofBranch)) {
    const kept = yield* readAgentPublished(userId, agent.id);
    return yield* withChecks(token, agent.repository, ofBranch.value, kept);
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

export const agentPublished = /* @__PURE__ */ Effect.fn("web/agentPublished")(function* (
  userId: string,
  agent: Agent,
): Effect.fn.Return<AgentPullRequestAnswer, PublishedReadFailure, PublishedServices> {
  yield* extrasPublished(userId, agent);
  const { answer, stored, ended } = yield* publishedOnGitHub(userId, agent);
  const at = yield* Clock.currentTimeMillis;
  const read = { at, branch: agent.branch, pushed: answer.branch !== null };
  const firstMerged = yield* recordAgentPublished(userId, agent.id, stored, read);
  yield* afterRecorded(userId, agent, firstMerged, ended);
  return answer;
});

const afterRecorded = (
  userId: string,
  agent: Agent,
  firstMerged: boolean,
  ended: PullRequestEnd | undefined,
) =>
  Effect.gen(function* () {
    if (firstMerged)
      yield* recordServerEvent(
        SERVER_EVENT.PULL_REQUEST_MERGE,
        { userId: agent.userId, workspaceId: agent.organizationId },
        {},
      );
    const merged = ended === PULL_REQUEST_STATE.MERGED;
    if (merged && agent.taskId !== null) yield* settleTaskIfFinished(userId, agent.taskId);
  });

const extraPublishedOnGitHub = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: WithRepository<Agent>,
  extra: AgentRepositoryEntry & { readonly headBranch: string },
): Effect.fn.Return<Published, PublishedReadFailure, PublishedServices> {
  const none: Published = {
    answer: { repository: extra.repository, branch: null, pullRequest: null },
    stored: null,
    ended: undefined,
  };
  const reached = yield* agentPullRequestReach(userId, agent, extra.repository);
  if (extra.headBranch === reached.repository.defaultBranch) return none;
  const ofBranch = yield* pullRequestOfBranch(reached.token, extra.repository, extra.headBranch);
  if (Option.isNone(ofBranch)) return none;
  return yield* withChecks(reached.token, extra.repository, ofBranch.value, extra.pullRequest);
});

const extrasPublished = (userId: string, agent: Agent) =>
  Effect.gen(function* () {
    if (!hasRepository(agent)) return;
    const [, ...extras] = yield* readAgentRepositories(userId, agent.id);
    yield* Effect.forEach(
      extras,
      (extra) => {
        const { headBranch } = extra;
        if (headBranch === null) return Effect.void;
        return Effect.gen(function* () {
          const { stored, answer, ended } = yield* extraPublishedOnGitHub(userId, agent, {
            ...extra,
            headBranch,
          });
          const at = yield* Clock.currentTimeMillis;
          const read = { at, branch: headBranch, pushed: answer.branch !== null };
          const firstMerged = yield* recordAgentRepositoryPublished(
            userId,
            agent.id,
            extra.repository,
            stored,
            read,
          );
          yield* afterRecorded(userId, agent, firstMerged, ended);
        }).pipe(Effect.catch(extraUnread));
      },
      { concurrency: "unbounded", discard: true },
    );
  }).pipe(Effect.catch(extraUnread));

function extraUnread(failure: unknown): Effect.Effect<void> {
  return Effect.logWarning(
    `an extra repository's pull request could not be read again: ${failureKind(failure)}`,
  );
}

export const pullRequestOfNumber = /* @__PURE__ */ Effect.fnUntraced(function* (
  token: Redacted.Redacted,
  repository: string,
  number: number,
): Effect.fn.Return<
  Option.Option<{ readonly branch: string; readonly pullRequest: AgentPullRequest }>,
  PullRequestReadFailure,
  HttpClient.HttpClient
> {
  const found = yield* pullRequestByNumber(token, repository, number);
  if (Option.isNone(found)) return Option.none();
  const checks = yield* checkSummaryOf(token, repository, found.value.headSha);
  const queued = yield* queuedOf(token, repository, found.value, null);
  return Option.some({
    branch: found.value.headRef,
    pullRequest: wirePullRequestOf(found.value, checks, queued),
  });
});

export const agentPullRequestOfNumber = /* @__PURE__ */ Effect.fn("web/agentPullRequestOfNumber")(
  function* (
    userId: string,
    agent: Agent,
    number: number,
  ): Effect.fn.Return<AgentPullRequestAnswer, PublishedReadFailure, PublishedServices> {
    if (!hasRepository(agent)) return nothing(agent).answer;
    const { token } = yield* agentPullRequestReach(userId, agent);
    const found = yield* pullRequestOfNumber(token, agent.repository, number);
    if (Option.isNone(found)) return nothing(agent).answer;
    return { repository: agent.repository, ...found.value };
  },
);

export class PublishedKey extends Data.Class<{
  readonly userId: string;
  readonly agentId: string;
  readonly ended: boolean;
}> {}

export type PublishedCache = Cache.Cache<
  PublishedKey,
  AgentPullRequestAnswer,
  PublishedReadFailure | NoSuchAgent,
  PublishedServices
>;

class NoSuchAgent extends Data.TaggedError("NoSuchAgent")<{ readonly agentId: string }> {}

const KEPT_AGENTS = 1_024;

function keptAnswer(agent: Agent, kept: KeptPublished): AgentPullRequestAnswer {
  if (kept.published === null) {
    const branch = kept.read.pushed ? kept.read.branch : null;
    return { repository: agent.repository, branch, pullRequest: null };
  }
  const { headSha: _headSha, mergedAt: _mergedAt, ...pullRequest } = kept.published;
  return { repository: agent.repository, branch: kept.read.branch, pullRequest };
}

function keptStands(agent: Agent, ended: boolean, kept: KeptPublished, now: number): boolean {
  if (agent.archivedAt !== null) return true;
  const state = kept.published?.state;
  const age = now - kept.read.at;
  if (ended && state === PULL_REQUEST_STATE.MERGED) return true;
  if (ended && state === PULL_REQUEST_STATE.CLOSED) {
    return age < Duration.toMillis(CODER.PUBLISHED_CLOSED_FRESH);
  }
  return age < Duration.toMillis(CODER.PUBLISHED_ROW_FRESH);
}

function rateLimited(failure: PublishedReadFailure): boolean {
  if (failure._tag !== "GitHubUnavailable") return false;
  return (
    failure.status === GITHUB_HTTP_STATUS.TOO_MANY_REQUESTS ||
    failure.status === GITHUB_HTTP_STATUS.FORBIDDEN
  );
}

const lookupPublished = (
  key: PublishedKey,
): Effect.Effect<AgentPullRequestAnswer, PublishedReadFailure | NoSuchAgent, PublishedServices> =>
  Effect.gen(function* () {
    const found = yield* readAgent(key.userId, key.agentId);
    if (Option.isNone(found)) return yield* new NoSuchAgent({ agentId: key.agentId });
    const agent = found.value;
    const row = yield* readAgentKeptPublished(key.userId, agent.id);
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

const publishedCache: Effect.Effect<PublishedCache> = Cache.makeWith(lookupPublished, {
  capacity: KEPT_AGENTS,
  requireServicesAt: "lookup",
  timeToLive: (exit) => (Exit.isSuccess(exit) ? CODER.PUBLISHED_TTL : Duration.zero),
});

export function instancePublishedCache(): Effect.Effect<PublishedCache> {
  let kept: PublishedCache | undefined;
  return Effect.suspend(() =>
    kept === undefined
      ? Effect.map(publishedCache, (made) => (kept ??= made))
      : Effect.succeed(kept),
  );
}

export interface PublishedReach {
  readonly published?: Effect.Effect<PublishedCache>;
}
