import {
  agentChangesAnswerViewSchema,
  agentOverviewChecksAnswerViewSchema,
  agentOverviewConversationAnswerViewSchema,
  agentOverviewPullRequestAnswerViewSchema,
  agentPullRequestAnswerViewSchema,
  agentPullRequestViewedAnswerViewSchema,
  agentPullRequestWriteAnswerViewSchema,
  repositoryPullRequestActionParamsSchema,
  repositoryPullRequestParamsSchema,
} from "@luke/features/agent-view";
import { pullRequestChaptersAnswerViewSchema } from "@luke/features/pull-request-chapters-view";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { PULL_REQUEST_ACT_KIND } from "./kinds.js";

/**
 * pull-requests.ts -- the asks of the host about a pull request named by its repository and number rather than by an agent, as procedures.
 *
 * Each names the workspace, the repository, and the number, and answers the
 * same view an agent's Pull request tab hears for the same read or change
 * (`agents.ts`, `chapters.ts`), so a tab draws either alike. Each output is
 * its view schema flipped, so oRPC's output check encodes the row's value
 * into what crosses the port, as every act contract's does.
 */
export const pullRequestActsContract = {
  [PULL_REQUEST_ACT_KIND.PULL_REQUESTS_READ]: actProcedure(
    "Could not read the pull request on this system.",
  )
    .input(exactInput(repositoryPullRequestParamsSchema))
    .output(EffectSchema.flip(agentPullRequestAnswerViewSchema)),
  [PULL_REQUEST_ACT_KIND.PULL_REQUESTS_CHANGES]: actProcedure(
    "Could not read the pull request's changes on this system.",
  )
    .input(exactInput(repositoryPullRequestParamsSchema))
    .output(EffectSchema.flip(agentChangesAnswerViewSchema)),
  [PULL_REQUEST_ACT_KIND.PULL_REQUESTS_OVERVIEW_PULL_REQUEST]: actProcedure(
    "Could not read the pull request on this system.",
  )
    .input(exactInput(repositoryPullRequestParamsSchema))
    .output(EffectSchema.flip(agentOverviewPullRequestAnswerViewSchema)),
  [PULL_REQUEST_ACT_KIND.PULL_REQUESTS_OVERVIEW_CHECKS]: actProcedure(
    "Could not read the pull request's checks on this system.",
  )
    .input(exactInput(repositoryPullRequestParamsSchema))
    .output(EffectSchema.flip(agentOverviewChecksAnswerViewSchema)),
  [PULL_REQUEST_ACT_KIND.PULL_REQUESTS_OVERVIEW_CONVERSATION]: actProcedure(
    "Could not read the pull request's conversation on this system.",
  )
    .input(exactInput(repositoryPullRequestParamsSchema))
    .output(EffectSchema.flip(agentOverviewConversationAnswerViewSchema)),
  [PULL_REQUEST_ACT_KIND.PULL_REQUESTS_ACTION]: actProcedure(
    "Could not change the pull request on this system.",
  )
    .input(exactInput(repositoryPullRequestActionParamsSchema))
    .output(EffectSchema.flip(agentPullRequestWriteAnswerViewSchema)),
  [PULL_REQUEST_ACT_KIND.PULL_REQUESTS_VIEWED]: actProcedure(
    "Could not read which files you viewed on this system.",
  )
    .input(exactInput(repositoryPullRequestParamsSchema))
    .output(EffectSchema.flip(agentPullRequestViewedAnswerViewSchema)),
  [PULL_REQUEST_ACT_KIND.PULL_REQUESTS_CHAPTERS]: actProcedure(
    "Could not read the pull request's chapters on this system.",
  )
    .input(exactInput(repositoryPullRequestParamsSchema))
    .output(EffectSchema.flip(pullRequestChaptersAnswerViewSchema)),
  [PULL_REQUEST_ACT_KIND.PULL_REQUESTS_CHAPTERS_GENERATE]: actProcedure(
    "Could not generate the pull request's chapters on this system.",
  )
    .input(exactInput(repositoryPullRequestParamsSchema))
    .output(EffectSchema.flip(pullRequestChaptersAnswerViewSchema)),
};
