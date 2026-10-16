import type { DatabaseServices } from "@luke/database/core/query";
import {
  type CodingAgent,
  type CodingAgentLatestTurn,
  latestTurnsOfReached,
  listCodingAgentsOnBranches,
  listCodingAgentsOnPullRequest,
  type OwnedCodingAgent,
} from "@luke/database/models/coding-agent-store";
import { storeWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { EXCESS_KEYS, type UnparsedWireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Effect, Result, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { codingAgentStatusOf } from "../agents/coder-host/status.js";
import { steerCodingAgent } from "../agents/coder-host/steer.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import type { EveForAccount } from "../automations/automation-runs.js";
import type { GitHubApp } from "./github-app.js";

/**
 * agent-wakes.ts -- a review, a comment, or a failed check on a coding agent's pull request, told to the agent as a message from GitHub.
 *
 * An agent's turn ends with its pull request open, and what happens on it
 * after reached nobody until the developer looked: a review, a comment, a
 * check that fails once the agent stopped watching. The Luke GitHub App's
 * webhook hands each delivery here as well, and three are read: a review
 * submitted (`pull_request_review`), which a lone inline comment and a reply
 * in a thread submit too, so a review's inline comments are never told one
 * by one; a comment on the pull request's conversation (`issue_comment` on
 * a pull request); and a check suite that completed without passing on an
 * agent's `luke/` branch, the one failure the automations leave to the agent
 * (`automation-github.ts`). `pull_request_review_comment` is answered and
 * ignored, since its review already told it. Only what the message says is
 * read off a delivery: the repository, the pull request's number and branch,
 * the address of the review, comment, or failed commit, the login of who
 * caused it, a review's verdict, and when; never a body, which the agent
 * reads itself with `gh`. A commit status that failed on a `luke/` branch
 * is told as a failed check is, since the pull request's checks count it
 * beside the check runs.
 *
 * The agents told are those standing on the pull request's branch, or, for
 * a comment, whose pull request GitHub last answered is the one commented
 * on, of whichever account. Each is told as a message steered to it as its
 * owner (`coder-host/steer.ts`), under the delivery's own id, so a delivery
 * GitHub sends twice is told once; the line is drawn as GitHub's, by the
 * login. A review or a comment by a person or another App reaches an agent
 * at work too, as a message steers a turn under way. One by Luke's own App
 * may be the agent's own, since every agent comments as that App, so it
 * reaches only an agent that was not at work when GitHub says it was made:
 * an agent comments only inside a turn, so one idle since before is not its
 * author. That is what keeps an agent's own replies from waking it, while
 * the code-review agent's findings on another agent's pull request do. A
 * failed check reaches only an agent idle since before it failed, since an
 * agent at work watches its own checks. An archived agent is told nothing.
 */

/** What a delivery tells an agent of. */
export const AGENT_WAKE = {
  REVIEW: "review",
  COMMENT: "comment",
  CHECK_FAILED: "check-failed",
} as const;

type AgentWakeKind = (typeof AGENT_WAKE)[keyof typeof AGENT_WAKE];

/** One delivery as the agents on its pull request are told of it. */
export interface AgentWake {
  readonly kind: AgentWakeKind;
  readonly repository: string;
  /** The branches the agents stand on, where the delivery names them; a comment's names only its pull request. */
  readonly branches: readonly string[];
  readonly pullRequest: number | undefined;
  /** The page of the review, the comment, or the failed commit's checks. */
  readonly url: string;
  /** Who caused it: a person's or an App's login, a failed check's by the App that ran it. */
  readonly by: string;
  /** When GitHub says it was made, in epoch milliseconds. */
  readonly at: number;
  /** A review's verdict, as GitHub spells it. */
  readonly verdict?: string | undefined;
}

/** The events read, by GitHub's own names, and the one action of each that tells an agent anything. */
const WAKE_EVENT = {
  PULL_REQUEST_REVIEW: "pull_request_review",
  ISSUE_COMMENT: "issue_comment",
  CHECK_SUITE: "check_suite",
  /** A commit status, which a pull request's checks count beside the check runs. */
  STATUS: "status",
} as const;

const WAKE_ACTION = {
  SUBMITTED: "submitted",
  CREATED: "created",
  COMPLETED: "completed",
} as const;

/** The conclusions of a check suite that read as failed. */
const FAILED_CONCLUSIONS: ReadonlySet<string> = new Set(["failure", "timed_out"]);

/** The states of a commit status that read as failed. */
const FAILED_STATES: ReadonlySet<string> = new Set(["failure", "error"]);

/** The branch prefix a coding agent works on (`coder-host/bounds.ts`), the only branches a failed check is told on. */
const AGENT_BRANCH_PREFIX = "luke/";

/** What GitHub appends to an App's login, which a failed check is told by. */
const BOT_LOGIN_SUFFIX = "[bot]";

/** The most agents one delivery tells, newest started first, so a delivery answers inside GitHub's ten seconds. */
const MAXIMUM_AGENTS_PER_WAKE = 10;

/** How each review verdict reads in the line, by GitHub's own word for it. */
const VERDICT_WORDS: ReadonlyMap<string, string> = new Map([
  ["approved", "approved"],
  ["changes_requested", "requested changes on"],
]);

/** What a review that is neither an approval nor a change request reads as. */
const REVIEWED = "reviewed";

/** The statuses under which an agent is at work. */
const AT_WORK: ReadonlySet<string> = new Set([
  CODING_AGENT_STATUS.STARTING,
  CODING_AGENT_STATUS.RUNNING,
]);

const RepositorySchema = Schema.Struct({ full_name: Schema.String });
const SenderSchema = Schema.Struct({ login: Schema.String });

const ReviewDeliverySchema = Schema.Struct({
  action: Schema.String,
  repository: RepositorySchema,
  sender: SenderSchema,
  review: Schema.Struct({
    state: Schema.String,
    html_url: Schema.String,
    submitted_at: Schema.NullOr(Schema.String),
  }),
  pull_request: Schema.Struct({ number: Schema.Int, head: Schema.Struct({ ref: Schema.String }) }),
});

const CommentDeliverySchema = Schema.Struct({
  action: Schema.String,
  repository: RepositorySchema,
  sender: SenderSchema,
  comment: Schema.Struct({ html_url: Schema.String, created_at: Schema.String }),
  // An issue's delivery says it is a pull request where it is one.
  issue: Schema.Struct({ number: Schema.Int, pull_request: Schema.optionalKey(Schema.Unknown) }),
});

const CheckSuiteDeliverySchema = Schema.Struct({
  action: Schema.String,
  repository: Schema.Struct({ full_name: Schema.String, html_url: Schema.String }),
  check_suite: Schema.Struct({
    head_branch: Schema.NullOr(Schema.String),
    head_sha: Schema.String,
    conclusion: Schema.NullOr(Schema.String),
    updated_at: Schema.String,
    app: Schema.optionalKey(Schema.NullOr(Schema.Struct({ slug: Schema.String }))),
    pull_requests: Schema.Array(Schema.Struct({ number: Schema.Int })),
  }),
});

const StatusDeliverySchema = Schema.Struct({
  state: Schema.String,
  sha: Schema.String,
  updated_at: Schema.String,
  repository: Schema.Struct({ full_name: Schema.String, html_url: Schema.String }),
  sender: SenderSchema,
  branches: Schema.Array(Schema.Struct({ name: Schema.String })),
});

/** A delivery read against the few fields it is read for; every other key GitHub sends is dropped unread. */
function readDelivery<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  payload: UnparsedWireValue,
) {
  return readEither(schema, { excess: EXCESS_KEYS.DROP })(payload);
}

/** An instant GitHub wrote, in epoch milliseconds, or `fallback` where it wrote none it can read. */
function instantOf(written: string | null, fallback: number): number {
  const at = written === null ? Number.NaN : Date.parse(written);
  return Number.isNaN(at) ? fallback : at;
}

/** A review submitted, as the agents on its pull request's branch are told of it. */
function reviewWake(payload: UnparsedWireValue, now: number): AgentWake | undefined {
  const read = readDelivery(ReviewDeliverySchema, payload);
  if (Result.isFailure(read) || read.success.action !== WAKE_ACTION.SUBMITTED) return undefined;
  const { repository, sender, review, pull_request: pullRequest } = read.success;
  return {
    kind: AGENT_WAKE.REVIEW,
    repository: repository.full_name,
    branches: [pullRequest.head.ref],
    pullRequest: pullRequest.number,
    url: review.html_url,
    by: sender.login,
    at: instantOf(review.submitted_at, now),
    verdict: review.state.toLowerCase(),
  };
}

/** A comment made on a pull request's conversation, as the agents whose pull request it is are told of it. */
function commentWake(payload: UnparsedWireValue, now: number): AgentWake | undefined {
  const read = readDelivery(CommentDeliverySchema, payload);
  if (
    Result.isFailure(read) ||
    read.success.action !== WAKE_ACTION.CREATED ||
    read.success.issue.pull_request === undefined
  ) {
    return undefined;
  }
  const { repository, sender, comment, issue } = read.success;
  return {
    kind: AGENT_WAKE.COMMENT,
    repository: repository.full_name,
    branches: [],
    pullRequest: issue.number,
    url: comment.html_url,
    by: sender.login,
    at: instantOf(comment.created_at, now),
  };
}

/** A check suite that completed without passing on an agent's branch, as the agent standing on it is told of it. */
function checkFailedWake(payload: UnparsedWireValue, now: number): AgentWake | undefined {
  const read = readDelivery(CheckSuiteDeliverySchema, payload);
  if (Result.isFailure(read)) return undefined;
  const { action, repository, check_suite: suite } = read.success;
  const branch = suite.head_branch;
  if (
    action !== WAKE_ACTION.COMPLETED ||
    !FAILED_CONCLUSIONS.has(suite.conclusion ?? "") ||
    branch === null ||
    !branch.startsWith(AGENT_BRANCH_PREFIX)
  ) {
    return undefined;
  }
  return {
    kind: AGENT_WAKE.CHECK_FAILED,
    repository: repository.full_name,
    branches: [branch],
    pullRequest: suite.pull_requests[0]?.number,
    // The failed commit's checks by its address, so the agent reads the revision that failed even after the branch moves on.
    url: `${repository.html_url}/commit/${suite.head_sha}/checks`,
    by: `${suite.app?.slug ?? "github"}${BOT_LOGIN_SUFFIX}`,
    at: instantOf(suite.updated_at, now),
  };
}

/** A commit status that failed on agents' branches, every `luke/` branch at the commit, told as a failed check is: by who set it, on the failed commit's checks. */
function statusFailedWake(payload: UnparsedWireValue, now: number): AgentWake | undefined {
  const read = readDelivery(StatusDeliverySchema, payload);
  if (Result.isFailure(read) || !FAILED_STATES.has(read.success.state)) return undefined;
  const { repository, sender, sha, branches } = read.success;
  const agentBranches = branches
    .map((each) => each.name)
    .filter((name) => name.startsWith(AGENT_BRANCH_PREFIX));
  if (agentBranches.length === 0) return undefined;
  return {
    kind: AGENT_WAKE.CHECK_FAILED,
    repository: repository.full_name,
    branches: agentBranches,
    pullRequest: undefined,
    url: `${repository.html_url}/commit/${sha}/checks`,
    by: sender.login,
    at: instantOf(read.success.updated_at, now),
  };
}

/** What a delivery tells the agents on its pull request, where it is one of those read; nothing otherwise. */
export function agentWakeOf(
  event: string,
  payload: UnparsedWireValue,
  now: number,
): AgentWake | undefined {
  switch (event) {
    case WAKE_EVENT.PULL_REQUEST_REVIEW:
      return reviewWake(payload, now);
    case WAKE_EVENT.ISSUE_COMMENT:
      return commentWake(payload, now);
    case WAKE_EVENT.CHECK_SUITE:
      return checkFailedWake(payload, now);
    case WAKE_EVENT.STATUS:
      return statusFailedWake(payload, now);
    default:
      return undefined;
  }
}

/** The pull request a line names, by its number where the delivery gave one. */
function pullRequestWords(wake: AgentWake): string {
  return wake.pullRequest === undefined
    ? "your pull request"
    : `your pull request #${wake.pullRequest}`;
}

/** The message the agent on `branch` is told, which is also the line its transcript draws as GitHub's. */
function agentWakeText(wake: AgentWake, branch: string | null): string {
  switch (wake.kind) {
    case AGENT_WAKE.REVIEW: {
      const verdict = VERDICT_WORDS.get(wake.verdict ?? "") ?? REVIEWED;
      return `@${wake.by} ${verdict} ${pullRequestWords(wake)}: ${wake.url}\n\nRead the review and its comments with \`gh\`, and act on them as you judge best.`;
    }
    case AGENT_WAKE.COMMENT:
      return `@${wake.by} commented on ${pullRequestWords(wake)}: ${wake.url}\n\nRead the comment with \`gh\`, and act on it as you judge best.`;
    case AGENT_WAKE.CHECK_FAILED:
      return `A check failed on your branch \`${branch ?? ""}\`: ${wake.url}\n\nRead why with \`gh\`, fix the cause, and push, as you watch your own checks.`;
  }
}

/**
 * Whether an agent is told of a delivery, from its newest turn and the
 * login of Luke's own App: never an archived agent; a review or a comment
 * by anyone but Luke's App always; and a failed check, or a review or a
 * comment by Luke's App, only where the agent is not at work and its newest
 * turn ended before GitHub says it was made: the agent did not make that
 * comment, and was not watching when that check failed, so a delivery that
 * arrives after the turn that watched it does not start another.
 */
export function agentIsWoken(
  wake: AgentWake,
  agent: Pick<CodingAgent, "archivedAt" | "createdAt">,
  turn: CodingAgentLatestTurn | undefined,
  lukeLogin: string | undefined,
  now: number,
): boolean {
  if (agent.archivedAt !== null) return false;
  const byLuke = lukeLogin !== undefined && wake.by.toLowerCase() === lukeLogin.toLowerCase();
  if (wake.kind !== AGENT_WAKE.CHECK_FAILED && !byLuke) return true;
  const atWork = AT_WORK.has(codingAgentStatusOf(turn, { createdAt: agent.createdAt, now }));
  const settledAt = turn?.settledAt?.getTime();
  return !atWork && (settledAt === undefined || settledAt < wake.at);
}

/** The agents a delivery is about: those on its branches, or, for a comment, those whose pull request it is. */
function agentsOf(wake: AgentWake) {
  if (wake.branches.length > 0) {
    return listCodingAgentsOnBranches(wake.repository, wake.branches, MAXIMUM_AGENTS_PER_WAKE);
  }
  if (wake.pullRequest === undefined) return Effect.succeed<readonly OwnedCodingAgent[]>([]);
  return listCodingAgentsOnPullRequest(wake.repository, wake.pullRequest, MAXIMUM_AGENTS_PER_WAKE);
}

/**
 * Tells every agent the delivery is about that `agentIsWoken` admits, each
 * through eve as the deployment acting for its owner, under the delivery's
 * id; answers how many were told. A send refused is logged by its kind
 * alone, and the delivery is still answered, as the webhook answers any.
 */
export const wakeAgents = /* @__PURE__ */ Effect.fn("web/githubWakeAgents")(function* (
  eveFor: EveForAccount,
  wake: AgentWake,
  deliveryId: string,
  lukeLogin: string | undefined,
): Effect.fn.Return<number, never, DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  // A delivery with no id has no key to be told once under, so it tells nobody.
  if (deliveryId === "") return 0;
  const now = yield* Clock.currentTimeMillis;
  const told = yield* Effect.gen(function* () {
    const agents = yield* agentsOf(wake);
    const turns = yield* latestTurnsOfReached(agents.map(({ agent }) => agent.conversationId));
    const woken = agents.filter(({ agent }) =>
      agentIsWoken(wake, agent, turns.get(agent.conversationId), lukeLogin, now),
    );
    return yield* Effect.forEach(woken, ({ userId, agent }) =>
      Effect.gen(function* () {
        const eve = yield* eveFor(userId);
        yield* steerCodingAgent(eve, storeWriter({ tools: CODER_TOOL_SET }), userId, agent, {
          text: agentWakeText(wake, agent.branch),
          clientKey: deliveryId,
          sender: { kind: MESSAGE_SENDER.GITHUB, login: wake.by },
        });
        return true;
      }).pipe(
        // The refusal's word alone: nothing of the delivery or the agent rides the line.
        Effect.catch((refusal) =>
          Effect.as(Effect.logWarning("github webhook: an agent was not told", { refusal }), false),
        ),
      ),
    );
  }).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning("github webhook: the agents to tell could not be read", {
          failure: failure._tag,
        }),
        [],
      ),
    ),
  );
  return told.filter(Boolean).length;
});
