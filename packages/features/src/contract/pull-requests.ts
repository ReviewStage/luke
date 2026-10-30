/**
 * pull-requests.ts -- one pull request of a workspace's repository, named by its repository and number rather than by an agent, as five reads.
 *
 * Each read names the pull request as a link names it, in the query: the
 * workspace whose installation reaches the repository, the repository's
 * full name, and the number, decoded as the GitHub resource's reads decode
 * them (`github.ts`). They mirror an agent's Pull request tab's reads
 * (`agent-pull-requests.ts`) and its changes (`agents.ts`), and answer the
 * same wire schemas, flipped (`packages/service/src/orpc/base.ts`), so a
 * client draws either alike.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  agentChangesAnswerSchema,
  agentOverviewChecksAnswerSchema,
  agentOverviewConversationAnswerSchema,
  agentOverviewPullRequestAnswerSchema,
  agentPullRequestAnswerSchema,
} from "../agent-wire.js";
import { hostedProcedure } from "./base.js";
import { numberedQuerySchema } from "./github.js";

/** The public paths, each naming the pull request in its query. */
const PULL_REQUEST_PATH = {
  PULL_REQUEST: "/api/pull-requests",
  CHANGES: "/api/pull-requests/changes",
  OVERVIEW_PULL_REQUEST: "/api/pull-requests/overview/pull-request",
  OVERVIEW_CHECKS: "/api/pull-requests/overview/checks",
  OVERVIEW_CONVERSATION: "/api/pull-requests/overview/conversation",
} as const;

/** A GET of one of the reads, the pull request named in its query. */
const read = (path: `/${string}`) =>
  hostedProcedure.meta(openapi({ method: HTTP_METHOD.GET, path })).input(numberedQuerySchema);

export const pullRequestsContract = {
  /** The pull request as GitHub holds it now, with its head's checks, and the branch it is from. */
  pullRequest: read(PULL_REQUEST_PATH.PULL_REQUEST).output(
    EffectSchema.flip(agentPullRequestAnswerSchema),
  ),
  /** Its changed files, who it names, and the commits its changed images are read at. */
  changes: read(PULL_REQUEST_PATH.CHANGES).output(EffectSchema.flip(agentChangesAnswerSchema)),
  /** The pull request itself, as its overview draws it. */
  overviewPullRequest: read(PULL_REQUEST_PATH.OVERVIEW_PULL_REQUEST).output(
    EffectSchema.flip(agentOverviewPullRequestAnswerSchema),
  ),
  /** The checks on its head and its deployments, as its overview draws them. */
  overviewChecks: read(PULL_REQUEST_PATH.OVERVIEW_CHECKS).output(
    EffectSchema.flip(agentOverviewChecksAnswerSchema),
  ),
  /** Its conversation and where its reviewers stand, as its overview draws them. */
  overviewConversation: read(PULL_REQUEST_PATH.OVERVIEW_CONVERSATION).output(
    EffectSchema.flip(agentOverviewConversationAnswerSchema),
  ),
};
