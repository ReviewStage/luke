/**
 * agent-pull-request-procedures.ts -- a coding agent's pull request as its Pull request tab reads and changes it.
 *
 * Every procedure resolves the caller first, then the agent its path names,
 * one of a workspace the caller's account is a member of: an agent of any
 * other workspace answers exactly as one that names nothing. Each is about
 * the pull request the agent published, from the instance's kept answers,
 * or the one of its repository the `number` query names, read afresh
 * (`asked-pull-request.ts`).
 *
 * What the agent published (`GET /api/agents/{id}/pull-request`) is the
 * branch and pull request its own transcript names, as GitHub holds them
 * now (`coder-host/published.ts`), kept per agent for a short while so a tab
 * asking beside every held page does not ask GitHub as often. Its overview,
 * which its Pull request tab draws, is read afresh on each ask in three
 * reads the tab asks for at once and draws as each lands: the pull request
 * itself, its description, branches, mergeability, author, and the
 * reviewers it asks for (`GET /api/agents/{id}/overview/pull-request`); its
 * head's checks one by one and its deployments
 * (`GET /api/agents/{id}/overview/checks`); and its conversation and where
 * its reviewers stand (`GET /api/agents/{id}/overview/conversation`), its
 * words as GitHub renders them. A change to that pull request
 * (`POST /api/agents/{id}/pull-request/action`), such as marking it ready for
 * review, submitting a review, replying on or resolving a review thread, or
 * commenting on it, is made on GitHub as the member who asks, on their own
 * GitHub sign-in and never the App's, through the one seam every such change
 * takes (`pull-request-write.ts`), and answers how GitHub took it; the
 * agent's kept published answer is let go, so the next read asks GitHub
 * afresh. Which of its files the member marked viewed on GitHub, a mark
 * GitHub keeps for each account, is read through the member's own sign-in
 * (`GET /api/agents/{id}/pull-request/viewed`), and set by two of the
 * changes.
 */

import type { CodingAgent } from "@luke/database/models/coding-agent-store";
import {
  type CodingAgentPullRequest,
  PULL_REQUEST_STATE,
  type PullRequestMerging,
} from "@luke/features/coding-agent-wire";
import {
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_BOUNDS,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestActionRequest,
  type PullRequestViewedAnswer,
} from "@luke/features/pull-request-write-wire";
import { Effect, Option, type Redacted } from "effect";
import type { HttpClient } from "effect/http";
import { namedOverviewConversation, namedOverviewPullRequest } from "../github/github-people.js";
import { githubReadOrRefusal, logGitHubReadFailure } from "../github/github-refusal.js";
import { pullRequestMerging } from "../github/pull-request-merging.js";
import {
  addLineComment,
  commentOnPullRequest,
  discardPendingReview,
  type GitHubWriteFailure,
  mergePullRequest,
  pullRequestNodeId,
  pullRequestViewedStates,
  reactOnPullRequest,
  replyToReviewThread,
  setAutoMerge,
  setFileViewed,
  setLabelled,
  setPullRequestDraft,
  setPullRequestOpen,
  setPullRequestTitle,
  setReviewRequested,
  setReviewThreadResolved,
  submitPullRequestReview,
  takeOutOfMergeQueue,
} from "../github/pull-request-writes.js";
import {
  GRAPHQL_REACTION_OF,
  type PullRequestReadFailure,
  pullRequestChecks,
  pullRequestConversation,
  pullRequestDeployments,
  pullRequestOverview,
  viewerPendingReviewOf,
  viewerReactionsOf,
} from "../github/pull-requests.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, bodyLimit, hosted } from "../orpc/base.js";
import { reachedAgentById } from "./agent-reach.js";
import {
  askedPublished,
  askedPullRequest,
  forgetPublished,
  pullRequestNumberOf,
} from "./asked-pull-request.js";
import {
  agentPullRequestReach,
  instancePublishedCache,
  type PublishedCache,
} from "./coder-host/published.js";
import {
  type MemberPullRequest,
  memberPullRequestWrite,
  memberReadToken,
  writeAnswerOf,
} from "./pull-request-write.js";

export interface AgentPullRequestProcedureSeams {
  resolveUserId: UserIdResolver;
}

/**
 * A change to a pull request names the change and its few fields, a
 * review's words the longest of them, so a body past this is no change.
 * Note that each of those words' characters may take six bytes as JSON,
 * a control character escaped as `\u0000`.
 */
const MAXIMUM_PULL_REQUEST_ACTION_BODY_BYTES = PULL_REQUEST_WRITE_BOUNDS.MAX_BODY_CHARS * 6 + 4_096;

/** The `number` a request names, as the query spelled it, read as the number it names. */
const numberNamed = (number: string | undefined) =>
  pullRequestNumberOf(number === undefined ? [] : [number]);

/** The agent the path names for the caller, and the pull request the tab asks about, null where there is none. */
const askedOfAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  published: Effect.Effect<PublishedCache>,
  userId: string,
  id: string,
  named: string | undefined,
) {
  const { agent } = yield* reachedAgentById(userId, id);
  const number = yield* numberNamed(named);
  const pullRequest = yield* askedPullRequest(yield* published, userId, agent, number);
  return { agent, pullRequest };
});

/** One of the overview's reads of the agent's pull request, on the token minted for its repository; null where GitHub holds no such pull request. */
type OverviewRead<A, R> = (
  token: Redacted.Redacted,
  agent: CodingAgent,
  pullRequest: CodingAgentPullRequest,
  /** The member reading, whose own reads mark what is theirs. */
  userId: string,
) => Effect.Effect<A | null, PullRequestReadFailure, R>;

/**
 * One part of the agent's pull request's overview: the pull request asked
 * about, read from GitHub afresh on a token minted for the agent's
 * repository; none where it names no pull request yet. Each part is a
 * procedure of its own, so each lands on its own.
 */
const overviewPart = <A, R>(
  agent: CodingAgent,
  pullRequest: CodingAgentPullRequest | null,
  userId: string,
  read: OverviewRead<A, R>,
) =>
  Effect.gen(function* () {
    if (pullRequest === null) return { pullRequest };
    const part = yield* Effect.gen(function* () {
      const { token } = yield* agentPullRequestReach(userId, agent);
      return yield* read(token, agent, pullRequest, userId);
    }).pipe(
      Effect.catch((failure) => {
        switch (failure._tag) {
          case "RepositoryNotReachable":
            return Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
          case "SqlError":
          case "EffectDrizzleQueryError":
          case "SchemaError":
            return hostedStoreOrUnavailable(Effect.fail(failure));
          default:
            return githubReadOrRefusal(Effect.fail(failure));
        }
      }),
    );
    // Note that a part may carry what is the reader's own, such as the reactions they gave or the review they hold pending, which every hosted answer's `private, no-store` keeps from anyone else.
    return { pullRequest: part };
  });

/** Whether the pull request was open as last read, which is when the stack it stands in is worth a read of GitHub's open pull requests. */
function stackable(pullRequest: CodingAgentPullRequest): boolean {
  return (
    pullRequest.state === PULL_REQUEST_STATE.OPEN || pullRequest.state === PULL_REQUEST_STATE.DRAFT
  );
}

/**
 * How the pull request may be merged, for its merge box; none where GitHub
 * would not say, logged by its kind, since the header it rides with stands
 * without it.
 */
const mergingOrNone = (token: Redacted.Redacted, repository: string, number: number) =>
  pullRequestMerging(token, repository, number).pipe(
    Effect.catch((failure) =>
      Effect.as(logGitHubReadFailure(failure), Option.none<PullRequestMerging>()),
    ),
  );

/**
 * The pull request itself: its description, branches, mergeability, who
 * opened it, who it asks for a review, its labels, and, while it was open as
 * last read, the stack it stands in, its people named against the
 * workspace's members and its stack by their agents (`github-people.ts`),
 * with who its row says it writes as; none where the repository no longer
 * holds it.
 */
const overviewPullRequestRead = (
  token: Redacted.Redacted,
  agent: CodingAgent,
  pullRequest: CodingAgentPullRequest,
) =>
  Effect.gen(function* () {
    const [read, merging] = yield* Effect.all(
      [
        pullRequestOverview(token, agent.repository, pullRequest.number, stackable(pullRequest)),
        mergingOrNone(token, agent.repository, pullRequest.number),
      ],
      { concurrency: "unbounded" },
    );
    if (Option.isNone(read)) return null;
    const named = yield* namedOverviewPullRequest(agent, read.value);
    return Option.isNone(merging) ? named : { ...named, merging: merging.value };
  });

/**
 * The checks on the pull request's head, failures first, up to the bound,
 * and its head's deployments beside them: three requests to GitHub at once
 * whatever their number, the check runs, the commit statuses, and the
 * deployments.
 */
const overviewChecksRead = (
  token: Redacted.Redacted,
  agent: CodingAgent,
  pullRequest: CodingAgentPullRequest,
) =>
  Effect.map(
    Effect.all(
      [
        pullRequestChecks(token, agent.repository, pullRequest.number),
        pullRequestDeployments(token, agent.repository, pullRequest.number),
      ],
      { concurrency: "unbounded" },
    ),
    ([checks, deployments]) => ({ checks, deployments }),
  );

/** Which reactions the member gave on the pull request, read on their own token; none where they hold none GitHub takes. */
const memberReactions = (userId: string, repository: string, number: number) =>
  Effect.flatMap(memberReadToken(userId), (token) =>
    token === undefined ? Effect.succeed(undefined) : viewerReactionsOf(token, repository, number),
  );

/** The review the member holds pending on the pull request, read on their own token; none where they hold none, or no sign-in GitHub takes. */
const memberPendingReview = (userId: string, repository: string, number: number) =>
  Effect.flatMap(memberReadToken(userId), (token) =>
    token === undefined ? Effect.succeed(null) : viewerPendingReviewOf(token, repository, number),
  );

/**
 * The pull request's conversation: its comments, its reviews and their
 * threads, and where each reviewer stands by their reviews, its people
 * named against the workspace's members; and, read beside it on the
 * member's own token, which reactions are theirs.
 */
const overviewConversationRead = (
  token: Redacted.Redacted,
  agent: CodingAgent,
  pullRequest: CodingAgentPullRequest,
  userId: string,
) =>
  Effect.map(
    Effect.all(
      [
        Effect.flatMap(
          pullRequestConversation(
            token,
            agent.repository,
            pullRequest,
            memberReactions(userId, agent.repository, pullRequest.number),
          ),
          (read) => namedOverviewConversation(agent, pullRequest.number, read),
        ),
        memberPendingReview(userId, agent.repository, pullRequest.number),
      ],
      { concurrency: "unbounded" },
    ),
    ([conversation, pendingReview]) =>
      conversation === null ? null : { ...conversation, pendingReview },
  );

/** The changes made by the pull request's number on GitHub's REST API, its requested reviewers and labels, which GraphQL cannot take a reviewer off of. */
type RestActionRequest = Extract<
  PullRequestActionRequest,
  {
    readonly action:
      | typeof PULL_REQUEST_ACTION.REQUEST_REVIEW
      | typeof PULL_REQUEST_ACTION.REMOVE_REVIEW_REQUEST
      | typeof PULL_REQUEST_ACTION.ADD_LABEL
      | typeof PULL_REQUEST_ACTION.REMOVE_LABEL;
  }
>;

/** The write a change makes on the pull request, on the member's token, by the pull request's GraphQL id. */
function writeOf(
  request: Exclude<PullRequestActionRequest, RestActionRequest>,
  token: Redacted.Redacted,
  id: string,
): Effect.Effect<void, GitHubWriteFailure, HttpClient.HttpClient> {
  switch (request.action) {
    case PULL_REQUEST_ACTION.READY_FOR_REVIEW:
      return setPullRequestDraft(token, id, false);
    case PULL_REQUEST_ACTION.CONVERT_TO_DRAFT:
      return setPullRequestDraft(token, id, true);
    case PULL_REQUEST_ACTION.MERGE:
      return mergePullRequest(token, id, request.method, request.headSha);
    case PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE:
      return setAutoMerge(token, id, { method: request.method, headSha: request.headSha });
    case PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE:
      return setAutoMerge(token, id, undefined);
    case PULL_REQUEST_ACTION.DEQUEUE:
      return takeOutOfMergeQueue(token, id);
    case PULL_REQUEST_ACTION.CLOSE:
      return setPullRequestOpen(token, id, false);
    case PULL_REQUEST_ACTION.REOPEN:
      return setPullRequestOpen(token, id, true);
    case PULL_REQUEST_ACTION.EDIT_TITLE:
      return setPullRequestTitle(token, id, request.title);
    case PULL_REQUEST_ACTION.SUBMIT_REVIEW:
      return submitPullRequestReview(token, id, request);
    case PULL_REQUEST_ACTION.REPLY_TO_THREAD:
      return replyToReviewThread(token, id, request);
    case PULL_REQUEST_ACTION.RESOLVE_THREAD:
    case PULL_REQUEST_ACTION.UNRESOLVE_THREAD:
      return setReviewThreadResolved(
        token,
        id,
        request.threadId,
        request.action === PULL_REQUEST_ACTION.RESOLVE_THREAD,
      );
    case PULL_REQUEST_ACTION.COMMENT:
      return commentOnPullRequest(token, id, request.body);
    case PULL_REQUEST_ACTION.ADD_REACTION:
    case PULL_REQUEST_ACTION.REMOVE_REACTION:
      return reactOnPullRequest(token, id, {
        subject: request.subject,
        content: GRAPHQL_REACTION_OF[request.content],
        add: request.action === PULL_REQUEST_ACTION.ADD_REACTION,
      });
    case PULL_REQUEST_ACTION.ADD_REVIEW_COMMENT: {
      const { action: _action, ...comment } = request;
      return addLineComment(token, id, comment);
    }
    case PULL_REQUEST_ACTION.DISCARD_REVIEW:
      return discardPendingReview(token, id);
    case PULL_REQUEST_ACTION.MARK_FILE_VIEWED:
    case PULL_REQUEST_ACTION.UNMARK_FILE_VIEWED:
      return setFileViewed(
        token,
        id,
        request.path,
        request.action === PULL_REQUEST_ACTION.MARK_FILE_VIEWED,
      );
  }
}

/** The write a change makes on the pull request, on the member's token. */
function actionWrite(
  request: PullRequestActionRequest,
): (
  pullRequest: MemberPullRequest,
) => Effect.Effect<void, GitHubWriteFailure, HttpClient.HttpClient> {
  return ({ token, repository, number }) => {
    switch (request.action) {
      case PULL_REQUEST_ACTION.REQUEST_REVIEW:
      case PULL_REQUEST_ACTION.REMOVE_REVIEW_REQUEST:
        return setReviewRequested(
          token,
          repository,
          number,
          request.reviewer,
          request.action === PULL_REQUEST_ACTION.REQUEST_REVIEW,
        );
      case PULL_REQUEST_ACTION.ADD_LABEL:
      case PULL_REQUEST_ACTION.REMOVE_LABEL:
        return setLabelled(
          token,
          repository,
          number,
          request.label,
          request.action === PULL_REQUEST_ACTION.ADD_LABEL,
        );
      default:
        return Effect.flatMap(pullRequestNodeId(token, repository, number), (id) =>
          writeOf(request, token, id),
        );
    }
  };
}

/** The agent pull request resource: the tab's five reads and its one change, to a signed-in member of the agent's workspace. */
export function agentPullRequestProcedures(seams: AgentPullRequestProcedureSeams) {
  const published = instancePublishedCache();
  const signedIn = hosted.agentPullRequests.use(accountMiddleware(seams.resolveUserId));
  const changing = signedIn.use(bodyLimit(MAXIMUM_PULL_REQUEST_ACTION_BODY_BYTES));
  return {
    /** What the agent published, from the instance's kept answers; or, where the request names a number, that pull request of its repository. */
    pullRequest: signedIn.pullRequest.effect(function* ({ input, context }) {
      const { agent } = yield* reachedAgentById(context.userId, input.id);
      const number = yield* numberNamed(input.number);
      return yield* askedPublished(yield* published, context.userId, agent, number);
    }),
    /**
     * One change to the pull request asked about, as the asking member on
     * their own GitHub sign-in (`pull-request-write.ts`), and how GitHub took
     * it; not found where the agent names no pull request yet. Whatever
     * GitHub answered, the kept answer is let go, so the reads after it ask
     * GitHub afresh.
     */
    action: changing.action.effect(function* ({ input, context }) {
      const { agent, pullRequest } = yield* askedOfAgent(
        published,
        context.userId,
        input.params.id,
        input.query?.number,
      );
      if (pullRequest === null) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const written = yield* memberPullRequestWrite(
        context.userId,
        agent,
        pullRequest.number,
        actionWrite(input.body),
      ).pipe(Effect.ensuring(Effect.flatMap(published, (kept) => forgetPublished(kept, agent.id))));
      return writeAnswerOf(written);
    }),
    /**
     * Which of the pull request's files the asking member marked viewed on
     * GitHub, on their own GitHub sign-in, since GitHub keeps the mark for
     * each account alone and the App sees none of it; no files where the
     * agent names no pull request yet. Nothing is let go, as nothing changed.
     */
    viewed: signedIn.viewed.effect(function* ({ input, context }) {
      const { agent, pullRequest } = yield* askedOfAgent(
        published,
        context.userId,
        input.id,
        input.number,
      );
      if (pullRequest === null) {
        const none: PullRequestViewedAnswer = {
          outcome: PULL_REQUEST_WRITE_OUTCOME.DONE,
          files: [],
        };
        return none;
      }
      const read = yield* memberPullRequestWrite(
        context.userId,
        agent,
        pullRequest.number,
        (member) => pullRequestViewedStates(member.token, member.repository, member.number),
      );
      const answer: PullRequestViewedAnswer =
        read.outcome === PULL_REQUEST_WRITE_OUTCOME.DONE
          ? { outcome: read.outcome, files: read.value }
          : read;
      return answer;
    }),
    overviewPullRequest: signedIn.overviewPullRequest.effect(function* ({ input, context }) {
      const { agent, pullRequest } = yield* askedOfAgent(
        published,
        context.userId,
        input.id,
        input.number,
      );
      return yield* overviewPart(agent, pullRequest, context.userId, overviewPullRequestRead);
    }),
    overviewChecks: signedIn.overviewChecks.effect(function* ({ input, context }) {
      const { agent, pullRequest } = yield* askedOfAgent(
        published,
        context.userId,
        input.id,
        input.number,
      );
      return yield* overviewPart(agent, pullRequest, context.userId, overviewChecksRead);
    }),
    overviewConversation: signedIn.overviewConversation.effect(function* ({ input, context }) {
      const { agent, pullRequest } = yield* askedOfAgent(
        published,
        context.userId,
        input.id,
        input.number,
      );
      return yield* overviewPart(agent, pullRequest, context.userId, overviewConversationRead);
    }),
  };
}
