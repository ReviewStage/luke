import { HTTP_METHOD } from "@repo/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  agentOverviewChecksAnswerSchema,
  agentOverviewConversationAnswerSchema,
  agentOverviewPullRequestAnswerSchema,
  agentPullRequestAnswerSchema,
} from "../agent-wire.js";
import {
  PULL_REQUEST_WRITE_BOUNDS,
  pullRequestActionRequestSchema,
  pullRequestViewedAnswerSchema,
  pullRequestWriteAnswerSchema,
} from "../pull-request-write-wire.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

export const PULL_REQUEST_ACTION_BODY_BYTES =
  PULL_REQUEST_WRITE_BOUNDS.MAX_BODY_CHARS * 2 * 6 + 4_096;

const AGENT_PULL_REQUEST_PATH = {
  PULL_REQUEST: "/api/agents/{id}/pull-request",
  ACTION: "/api/agents/{id}/pull-request/action",
  VIEWED: "/api/agents/{id}/pull-request/viewed",
  OVERVIEW_PULL_REQUEST: "/api/agents/{id}/overview/pull-request",
  OVERVIEW_CHECKS: "/api/agents/{id}/overview/checks",
  OVERVIEW_CONVERSATION: "/api/agents/{id}/overview/conversation",
} as const;

const numberQuery = EffectSchema.optionalKey(EffectSchema.String);

const readInput = EffectSchema.Struct({ id: EffectSchema.String, number: numberQuery });

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

const read = (path: `/${string}`) =>
  hostedProcedure.meta(openapi({ method: HTTP_METHOD.GET, path })).input(readInput);

export const agentPullRequestsContract = {
  pullRequest: read(AGENT_PULL_REQUEST_PATH.PULL_REQUEST).output(
    EffectSchema.flip(agentPullRequestAnswerSchema),
  ),
  action: hostedProcedure
    .meta(bodyCap(PULL_REQUEST_ACTION_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: AGENT_PULL_REQUEST_PATH.ACTION,
        inputStructure: "detailed",
      }),
    )
    .input(actionInput)
    .output(EffectSchema.flip(pullRequestWriteAnswerSchema)),
  viewed: read(AGENT_PULL_REQUEST_PATH.VIEWED).output(
    EffectSchema.flip(pullRequestViewedAnswerSchema),
  ),
  overviewPullRequest: read(AGENT_PULL_REQUEST_PATH.OVERVIEW_PULL_REQUEST).output(
    EffectSchema.flip(agentOverviewPullRequestAnswerSchema),
  ),
  overviewChecks: read(AGENT_PULL_REQUEST_PATH.OVERVIEW_CHECKS).output(
    EffectSchema.flip(agentOverviewChecksAnswerSchema),
  ),
  overviewConversation: read(AGENT_PULL_REQUEST_PATH.OVERVIEW_CONVERSATION).output(
    EffectSchema.flip(agentOverviewConversationAnswerSchema),
  ),
};
