/**
 * pull-requests.ts -- one pull request of a workspace's repository, named by its repository and number rather than by an agent, as six reads and one change.
 *
 * Each names the pull request as a link names it, in the query: the
 * workspace whose installation reaches the repository, the repository's
 * full name, and the number, decoded as the GitHub resource's reads decode
 * them (`github.ts`). They mirror an agent's Pull request tab's reads and
 * its change (`agent-pull-requests.ts`) and its changes (`agents.ts`), and
 * answer the same wire schemas, flipped (`packages/service/src/orpc/base.ts`),
 * so a client draws either alike. The change takes its input detailed, as
 * the agent's does: the query names the pull request, and the body is the
 * change alone, read exactly.
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
import {
  pullRequestActionRequestSchema,
  pullRequestViewedAnswerSchema,
  pullRequestWriteAnswerSchema,
} from "../pull-request-write-wire.js";
import { PULL_REQUEST_ACTION_BODY_BYTES } from "./agent-pull-requests.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";
import { numberedQuerySchema } from "./github.js";

/** The public paths, each naming the pull request in its query. */
const PULL_REQUEST_PATH = {
  PULL_REQUEST: "/api/pull-requests",
  CHANGES: "/api/pull-requests/changes",
  ACTION: "/api/pull-requests/action",
  VIEWED: "/api/pull-requests/viewed",
  OVERVIEW_PULL_REQUEST: "/api/pull-requests/overview/pull-request",
  OVERVIEW_CHECKS: "/api/pull-requests/overview/checks",
  OVERVIEW_CONVERSATION: "/api/pull-requests/overview/conversation",
} as const;

/** A GET of one of the reads, the pull request named in its query. */
const read = (path: `/${string}`) =>
  hostedProcedure.meta(openapi({ method: HTTP_METHOD.GET, path })).input(numberedQuerySchema);

/** The change's input, detailed: the pull request in the query, beside whatever else a caller wrote there, and the change itself as the body, read exactly. */
const actionInput = exactInput(
  EffectSchema.Struct({
    // Note that the path names nothing, so its parameters are passed over as the headers are.
    params: EffectSchema.optionalKey(EffectSchema.Unknown),
    query: EffectSchema.StructWithRest(numberedQuerySchema, [
      EffectSchema.Record(EffectSchema.String, EffectSchema.Unknown),
    ]),
    headers: EffectSchema.optionalKey(EffectSchema.Unknown),
    body: pullRequestActionRequestSchema,
  }),
);

export const pullRequestsContract = {
  /** The pull request as GitHub holds it now, with its head's checks, and the branch it is from. */
  pullRequest: read(PULL_REQUEST_PATH.PULL_REQUEST).output(
    EffectSchema.flip(agentPullRequestAnswerSchema),
  ),
  /** Its changed files, who it names, and the commits its changed images are read at. */
  changes: read(PULL_REQUEST_PATH.CHANGES).output(EffectSchema.flip(agentChangesAnswerSchema)),
  /** One change to the pull request, made on GitHub as the asking member. */
  action: hostedProcedure
    .meta(bodyCap(PULL_REQUEST_ACTION_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: PULL_REQUEST_PATH.ACTION,
        inputStructure: "detailed",
      }),
    )
    .input(actionInput)
    .output(EffectSchema.flip(pullRequestWriteAnswerSchema)),
  /** Which of the pull request's files the asking member marked viewed on GitHub. */
  viewed: read(PULL_REQUEST_PATH.VIEWED).output(EffectSchema.flip(pullRequestViewedAnswerSchema)),
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
