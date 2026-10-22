/**
 * agent-pull-requests.ts -- a coding agent's pull request as its Pull request tab reads and changes it, as six procedures.
 *
 * Each names the agent by its id in the path and, where the tab shows a
 * pull request of the agent's repository other than the agent's own, that
 * pull request's number in the `number` query, which the service reads as it
 * always did, so it travels as the query's own text. The outputs are the
 * wire schemas flipped (`packages/service/src/orpc/base.ts`). The change is
 * the one procedure with a body, read exactly, and with a path and a query
 * beside it, so it takes its input detailed: the body stays the change
 * alone, its keys counted as the old endpoint counted them.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  codingAgentOverviewChecksAnswerSchema,
  codingAgentOverviewConversationAnswerSchema,
  codingAgentOverviewPullRequestAnswerSchema,
  codingAgentPullRequestAnswerSchema,
} from "../coding-agent-wire.js";
import {
  PULL_REQUEST_WRITE_BOUNDS,
  pullRequestActionRequestSchema,
  pullRequestViewedAnswerSchema,
  pullRequestWriteAnswerSchema,
} from "../pull-request-write-wire.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

/**
 * A change to a pull request names the change and its few fields, a
 * review's words the longest of them, so a body past this is no change.
 * Note that each of those words' characters may take six bytes as JSON,
 * a control character escaped as `\u0000`.
 */
const ACTION_BODY_BYTES = PULL_REQUEST_WRITE_BOUNDS.MAX_BODY_CHARS * 6 + 4_096;

/** The public paths, each naming the agent under `{id}`. */
const AGENT_PULL_REQUEST_PATH = {
  PULL_REQUEST: "/api/agents/{id}/pull-request",
  ACTION: "/api/agents/{id}/pull-request/action",
  VIEWED: "/api/agents/{id}/pull-request/viewed",
  OVERVIEW_PULL_REQUEST: "/api/agents/{id}/overview/pull-request",
  OVERVIEW_CHECKS: "/api/agents/{id}/overview/checks",
  OVERVIEW_CONVERSATION: "/api/agents/{id}/overview/conversation",
} as const;

/** The pull request a read is about: the agent's, or the one of its repository `number` names, as the query spells it. */
const numberQuery = EffectSchema.optionalKey(EffectSchema.String);

/** A read's input: the agent in the path, and the number in the query where the tab names one. */
const readInput = EffectSchema.Struct({ id: EffectSchema.String, number: numberQuery });

/**
 * The change's input, detailed: the agent in the path, the number in the
 * query beside whatever else the rewrite wrote there, and the change itself
 * as the body, read exactly.
 */
const actionInput = exactInput(
  EffectSchema.Struct({
    params: EffectSchema.Struct({ id: EffectSchema.String }),
    query: EffectSchema.optionalKey(
      EffectSchema.StructWithRest(EffectSchema.Struct({ number: numberQuery }), [
        EffectSchema.Record(EffectSchema.String, EffectSchema.Unknown),
      ]),
    ),
    headers: EffectSchema.optionalKey(EffectSchema.Unknown),
    body: pullRequestActionRequestSchema,
  }),
);

/** A GET of one of the tab's reads. */
const read = (path: `/${string}`) =>
  hostedProcedure.meta(openapi({ method: HTTP_METHOD.GET, path })).input(readInput);

export const agentPullRequestsContract = {
  /** What the agent published: the branch it pushed and the pull request from it, as GitHub holds them. */
  pullRequest: read(AGENT_PULL_REQUEST_PATH.PULL_REQUEST).output(
    EffectSchema.flip(codingAgentPullRequestAnswerSchema),
  ),
  /** One change to the pull request, made on GitHub as the asking member. */
  action: hostedProcedure
    .meta(bodyCap(ACTION_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: AGENT_PULL_REQUEST_PATH.ACTION,
        inputStructure: "detailed",
      }),
    )
    .input(actionInput)
    .output(EffectSchema.flip(pullRequestWriteAnswerSchema)),
  /** Which of the pull request's files the asking member marked viewed on GitHub. */
  viewed: read(AGENT_PULL_REQUEST_PATH.VIEWED).output(
    EffectSchema.flip(pullRequestViewedAnswerSchema),
  ),
  /** The pull request itself, as its overview draws it. */
  overviewPullRequest: read(AGENT_PULL_REQUEST_PATH.OVERVIEW_PULL_REQUEST).output(
    EffectSchema.flip(codingAgentOverviewPullRequestAnswerSchema),
  ),
  /** The checks on its head and its deployments, as its overview draws them. */
  overviewChecks: read(AGENT_PULL_REQUEST_PATH.OVERVIEW_CHECKS).output(
    EffectSchema.flip(codingAgentOverviewChecksAnswerSchema),
  ),
  /** Its conversation and where its reviewers stand, as its overview draws them. */
  overviewConversation: read(AGENT_PULL_REQUEST_PATH.OVERVIEW_CONVERSATION).output(
    EffectSchema.flip(codingAgentOverviewConversationAnswerSchema),
  ),
};
