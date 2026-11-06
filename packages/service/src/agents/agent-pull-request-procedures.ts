import { type Agent, hasRepository } from "@repo/database/models/agent-store";
import {
  type AgentPullRequest,
  PULL_REQUEST_STATE,
  type PullRequestMerging,
} from "@repo/features/agent-wire";
import {
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestActionRequest,
  type PullRequestViewedAnswer,
} from "@repo/features/pull-request-write-wire";
import { Effect, Option, type Redacted } from "effect";
import type { HttpClient } from "effect/http";
import {
  recordServerEvent,
  SERVER_EVENT,
  SERVER_PULL_REQUEST_ACTION,
} from "../events/server-events.js";
import {
  namedOverviewConversation,
  namedOverviewPullRequest,
  namedPendingReview,
} from "../github/github-people.js";
import { logGitHubReadFailure } from "../github/github-refusal.js";
import { pullRequestMerging } from "../github/pull-request-merging.js";
import {
  addLineComment,
  commentOnPullRequest,
  deletePendingComment,
  discardPendingReview,
  editPendingComment,
  type GitHubWriteFailure,
  mergePullRequest,
  pullRequestNodeId,
  pullRequestViewedStates,
  reactOnPullRequest,
  replyToReviewThread,
  setAutoMerge,
  setFileViewed,
  setLabeled,
  setPullRequestDescription,
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
  viewerCanUpdateOf,
  viewerPendingReviewOf,
  viewerReactionsOf,
} from "../github/pull-requests.js";
import { HOSTED_REFUSAL, type UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { reachedAgentById } from "./agent-reach.js";
import {
  askedPublished,
  askedPullRequest,
  forgetPublished,
  githubReadRefusal,
  type PullRequestSubject,
  pullRequestNumberOf,
} from "./asked-pull-request.js";
import {
  agentPullRequestReach,
  instancePublishedCache,
  type PublishedCache,
  type PublishedReach,
} from "./coder-host/published.js";
import {
  type MemberPullRequest,
  type MemberWritten,
  memberPullRequestWrite,
  memberReadToken,
  writeAnswerOf,
} from "./pull-request-write.js";

export interface AgentPullRequestProcedureSeams extends PublishedReach {
  resolveUserId: UserIdResolver;
}

const numberNamed = (number: string | undefined) =>
  pullRequestNumberOf(number === undefined ? [] : [number]);

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

export type OverviewRead<A, R> = (
  token: Redacted.Redacted,
  subject: PullRequestSubject,
  pullRequest: AgentPullRequest,
  userId: string,
) => Effect.Effect<A | null, PullRequestReadFailure, R>;

const overviewPart = <A, R>(
  agent: Agent,
  pullRequest: AgentPullRequest | null,
  userId: string,
  read: OverviewRead<A, R>,
) =>
  Effect.gen(function* () {
    if (pullRequest === null || !hasRepository(agent)) return { pullRequest: null };
    const part = yield* Effect.gen(function* () {
      const { token } = yield* agentPullRequestReach(userId, agent);
      return yield* read(token, agent, pullRequest, userId);
    }).pipe(githubReadRefusal);
    return { pullRequest: part };
  });

function stackable(pullRequest: AgentPullRequest): boolean {
  return (
    pullRequest.state === PULL_REQUEST_STATE.OPEN || pullRequest.state === PULL_REQUEST_STATE.DRAFT
  );
}

const mergingOrNone = (token: Redacted.Redacted, repository: string, number: number) =>
  pullRequestMerging(token, repository, number).pipe(
    Effect.catch((failure) =>
      Effect.as(logGitHubReadFailure(failure), Option.none<PullRequestMerging>()),
    ),
  );

const memberCanEdit = (userId: string, repository: string, number: number) =>
  Effect.flatMap(memberReadToken(userId), (token) =>
    token === undefined ? Effect.succeed(false) : viewerCanUpdateOf(token, repository, number),
  );

export const overviewPullRequestRead = (
  token: Redacted.Redacted,
  subject: PullRequestSubject,
  pullRequest: AgentPullRequest,
  userId: string,
) =>
  Effect.gen(function* () {
    const { repository } = subject;
    const [read, merging, canEditDescription] = yield* Effect.all(
      [
        pullRequestOverview(token, repository, pullRequest.number, stackable(pullRequest)),
        mergingOrNone(token, repository, pullRequest.number),
        memberCanEdit(userId, repository, pullRequest.number),
      ],
      { concurrency: "unbounded" },
    );
    if (Option.isNone(read)) return null;
    const named = { ...(yield* namedOverviewPullRequest(subject, read.value)), canEditDescription };
    return Option.isNone(merging) ? named : { ...named, merging: merging.value };
  });

export const overviewChecksRead = (
  token: Redacted.Redacted,
  subject: PullRequestSubject,
  pullRequest: AgentPullRequest,
) =>
  Effect.map(
    Effect.all(
      [
        pullRequestChecks(token, subject.repository, pullRequest.number),
        pullRequestDeployments(token, subject.repository, pullRequest.number),
      ],
      { concurrency: "unbounded" },
    ),
    ([checks, deployments]) => ({ checks, deployments }),
  );

const memberReactions = (userId: string, repository: string, number: number) =>
  Effect.flatMap(memberReadToken(userId), (token) =>
    token === undefined ? Effect.succeed(undefined) : viewerReactionsOf(token, repository, number),
  );

const memberPendingReview = (userId: string, repository: string, number: number) =>
  Effect.flatMap(memberReadToken(userId), (token) =>
    token === undefined ? Effect.succeed(null) : viewerPendingReviewOf(token, repository, number),
  );

export const overviewConversationRead = (
  token: Redacted.Redacted,
  subject: PullRequestSubject,
  pullRequest: AgentPullRequest,
  userId: string,
) =>
  Effect.map(
    Effect.all(
      [
        Effect.flatMap(
          pullRequestConversation(
            token,
            subject.repository,
            pullRequest,
            memberReactions(userId, subject.repository, pullRequest.number),
          ),
          (read) => namedOverviewConversation(subject, pullRequest.number, read),
        ),
        Effect.flatMap(
          memberPendingReview(userId, subject.repository, pullRequest.number),
          (pending) => namedPendingReview(subject, pullRequest.number, pending),
        ),
      ],
      { concurrency: "unbounded" },
    ),
    ([conversation, pendingReview]) =>
      conversation === null ? null : { ...conversation, pendingReview },
  );

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
    case PULL_REQUEST_ACTION.EDIT_DESCRIPTION:
      return setPullRequestDescription(token, id, request);
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
    case PULL_REQUEST_ACTION.EDIT_REVIEW_COMMENT:
      return editPendingComment(token, id, request);
    case PULL_REQUEST_ACTION.DELETE_REVIEW_COMMENT:
      return deletePendingComment(token, id, request.commentId);
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

function countedAction(request: PullRequestActionRequest) {
  switch (request.action) {
    case PULL_REQUEST_ACTION.MERGE:
      return SERVER_PULL_REQUEST_ACTION.MERGE;
    case PULL_REQUEST_ACTION.SUBMIT_REVIEW:
      return SERVER_PULL_REQUEST_ACTION.REVIEW;
    case PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE:
      return SERVER_PULL_REQUEST_ACTION.AUTO_MERGE;
    case PULL_REQUEST_ACTION.CLOSE:
      return SERVER_PULL_REQUEST_ACTION.CLOSE;
    default:
      return undefined;
  }
}

export function actionWrite(
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
        return setLabeled(
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

export const agentPullRequestAction = /* @__PURE__ */ Effect.fnUntraced(function* (
  published: Effect.Effect<PublishedCache>,
  userId: string,
  agent: Agent,
  number: number | undefined,
  request: PullRequestActionRequest,
) {
  const pullRequest = yield* askedPullRequest(yield* published, userId, agent, number);
  if (pullRequest === null || !hasRepository(agent)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  const written = yield* memberPullRequestWrite(
    userId,
    agent,
    pullRequest.number,
    actionWrite(request),
  ).pipe(
    Effect.ensuring(Effect.flatMap(published, (kept) => forgetPublished(kept, userId, agent.id))),
  );
  const counted = countedAction(request);
  if (counted !== undefined && written.outcome === PULL_REQUEST_WRITE_OUTCOME.DONE) {
    yield* recordServerEvent(
      SERVER_EVENT.PULL_REQUEST_ACTION,
      { userId, workspaceId: agent.organizationId },
      { action: counted },
    );
  }
  return writeAnswerOf(written);
});

export const viewedRead = (member: MemberPullRequest) =>
  pullRequestViewedStates(member.token, member.repository, member.number);

export function viewedAnswerOf(
  read: MemberWritten<Effect.Success<ReturnType<typeof viewedRead>>>,
): PullRequestViewedAnswer {
  return read.outcome === PULL_REQUEST_WRITE_OUTCOME.DONE
    ? { outcome: read.outcome, files: read.value }
    : read;
}

export function agentPullRequestProcedures(seams: AgentPullRequestProcedureSeams) {
  const published = seams.published ?? instancePublishedCache();
  const signedIn = hosted.agentPullRequests.use(accountMiddleware(seams.resolveUserId));
  return {
    pullRequest: signedIn.pullRequest.effect(function* ({ input, context }) {
      const { agent } = yield* reachedAgentById(context.userId, input.id);
      const number = yield* numberNamed(input.number);
      return yield* askedPublished(yield* published, context.userId, agent, number);
    }),
    action: signedIn.action.effect(function* ({ input, context }) {
      const { agent } = yield* reachedAgentById(context.userId, input.params.id);
      const number = yield* numberNamed(input.query?.number);
      return yield* agentPullRequestAction(published, context.userId, agent, number, input.body);
    }),
    viewed: signedIn.viewed.effect(function* ({ input, context }) {
      const { agent, pullRequest } = yield* askedOfAgent(
        published,
        context.userId,
        input.id,
        input.number,
      );
      if (pullRequest === null || !hasRepository(agent)) {
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
        viewedRead,
      );
      return viewedAnswerOf(read);
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
