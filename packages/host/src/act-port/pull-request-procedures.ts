import type {
  AgentChangesAnswerView,
  AgentOverviewChecksAnswerView,
  AgentOverviewConversationAnswerView,
  AgentOverviewPullRequestAnswerView,
  AgentPullRequestAnswerView,
  AgentPullRequestViewedAnswerView,
  AgentPullRequestWriteAnswerView,
  RepositoryPullRequestActionParams,
  RepositoryPullRequestParams,
} from "@luke/features/agent-view";
import type { PullRequestChaptersAnswerView } from "@luke/features/pull-request-chapters-view";
import { Effect } from "effect";
import { PULL_REQUEST_ACT_KIND } from "../contract/index.js";
import { actPort } from "./base.js";

/**
 * pull-request-procedures.ts -- a Pull request tab's asks of the host about a pull request named by its repository and number: its reads, its chapters, and a change to it.
 *
 * The one check these procedures make is who asked: only a panel draws a
 * Pull request tab, so the takeover and any other window are refused in each
 * one's own sentence. What the service answers comes back as the panel's own
 * answer, or why there is none. Nothing is held here.
 */
export interface PullRequestProceduresDependencies {
  host: {
    repositoryPullRequest(
      params: RepositoryPullRequestParams,
    ): Effect.Effect<AgentPullRequestAnswerView>;
    repositoryChanges(params: RepositoryPullRequestParams): Effect.Effect<AgentChangesAnswerView>;
    repositoryOverviewPullRequest(
      params: RepositoryPullRequestParams,
    ): Effect.Effect<AgentOverviewPullRequestAnswerView>;
    repositoryOverviewChecks(
      params: RepositoryPullRequestParams,
    ): Effect.Effect<AgentOverviewChecksAnswerView>;
    repositoryOverviewConversation(
      params: RepositoryPullRequestParams,
    ): Effect.Effect<AgentOverviewConversationAnswerView>;
    repositoryPullRequestAction(
      params: RepositoryPullRequestActionParams,
    ): Effect.Effect<AgentPullRequestWriteAnswerView>;
    repositoryPullRequestViewed(
      params: RepositoryPullRequestParams,
    ): Effect.Effect<AgentPullRequestViewedAnswerView>;
    repositoryChapters(
      params: RepositoryPullRequestParams,
    ): Effect.Effect<PullRequestChaptersAnswerView>;
    repositoryChaptersGenerate(
      params: RepositoryPullRequestParams,
    ): Effect.Effect<PullRequestChaptersAnswerView>;
  };
}

export function pullRequestProcedures(dependencies: PullRequestProceduresDependencies) {
  const { host } = dependencies;
  return {
    [PULL_REQUEST_ACT_KIND.PULL_REQUESTS_READ]: actPort[
      PULL_REQUEST_ACT_KIND.PULL_REQUESTS_READ
    ].effect(function* ({ input, context, errors }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.repositoryPullRequest(input);
    }),
    [PULL_REQUEST_ACT_KIND.PULL_REQUESTS_CHANGES]: actPort[
      PULL_REQUEST_ACT_KIND.PULL_REQUESTS_CHANGES
    ].effect(function* ({ input, context, errors }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.repositoryChanges(input);
    }),
    [PULL_REQUEST_ACT_KIND.PULL_REQUESTS_OVERVIEW_PULL_REQUEST]: actPort[
      PULL_REQUEST_ACT_KIND.PULL_REQUESTS_OVERVIEW_PULL_REQUEST
    ].effect(function* ({ input, context, errors }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.repositoryOverviewPullRequest(input);
    }),
    [PULL_REQUEST_ACT_KIND.PULL_REQUESTS_OVERVIEW_CHECKS]: actPort[
      PULL_REQUEST_ACT_KIND.PULL_REQUESTS_OVERVIEW_CHECKS
    ].effect(function* ({ input, context, errors }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.repositoryOverviewChecks(input);
    }),
    [PULL_REQUEST_ACT_KIND.PULL_REQUESTS_OVERVIEW_CONVERSATION]: actPort[
      PULL_REQUEST_ACT_KIND.PULL_REQUESTS_OVERVIEW_CONVERSATION
    ].effect(function* ({ input, context, errors }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.repositoryOverviewConversation(input);
    }),
    [PULL_REQUEST_ACT_KIND.PULL_REQUESTS_ACTION]: actPort[
      PULL_REQUEST_ACT_KIND.PULL_REQUESTS_ACTION
    ].effect(function* ({ input, context, errors }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.repositoryPullRequestAction(input);
    }),
    [PULL_REQUEST_ACT_KIND.PULL_REQUESTS_VIEWED]: actPort[
      PULL_REQUEST_ACT_KIND.PULL_REQUESTS_VIEWED
    ].effect(function* ({ input, context, errors }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.repositoryPullRequestViewed(input);
    }),
    [PULL_REQUEST_ACT_KIND.PULL_REQUESTS_CHAPTERS]: actPort[
      PULL_REQUEST_ACT_KIND.PULL_REQUESTS_CHAPTERS
    ].effect(function* ({ input, context, errors }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.repositoryChapters(input);
    }),
    [PULL_REQUEST_ACT_KIND.PULL_REQUESTS_CHAPTERS_GENERATE]: actPort[
      PULL_REQUEST_ACT_KIND.PULL_REQUESTS_CHAPTERS_GENERATE
    ].effect(function* ({ input, context, errors }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.repositoryChaptersGenerate(input);
    }),
  };
}
