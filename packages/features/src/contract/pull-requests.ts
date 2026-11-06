import { HTTP_METHOD } from "@repo/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  agentChangesAnswerSchema,
  agentOverviewChecksAnswerSchema,
  agentOverviewConversationAnswerSchema,
  agentOverviewPullRequestAnswerSchema,
  agentPullRequestAnswerSchema,
  agentReviewOptionsAnswerSchema,
} from "../agent-wire.js";
import {
  pullRequestActionRequestSchema,
  pullRequestViewedAnswerSchema,
  pullRequestWriteAnswerSchema,
} from "../pull-request-write-wire.js";
import { PULL_REQUEST_ACTION_BODY_BYTES } from "./agent-pull-requests.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";
import { numberedQuerySchema } from "./github.js";

const PULL_REQUEST_PATH = {
  PULL_REQUEST: "/api/pull-requests",
  CHANGES: "/api/pull-requests/changes",
  ACTION: "/api/pull-requests/action",
  VIEWED: "/api/pull-requests/viewed",
  REVIEW_OPTIONS: "/api/pull-requests/review-options",
  OVERVIEW_PULL_REQUEST: "/api/pull-requests/overview/pull-request",
  OVERVIEW_CHECKS: "/api/pull-requests/overview/checks",
  OVERVIEW_CONVERSATION: "/api/pull-requests/overview/conversation",
} as const;

const read = (path: `/${string}`) =>
  hostedProcedure.meta(openapi({ method: HTTP_METHOD.GET, path })).input(numberedQuerySchema);

const actionInput = exactInput(
  EffectSchema.Struct({
    params: EffectSchema.optionalKey(EffectSchema.Unknown),
    query: EffectSchema.StructWithRest(numberedQuerySchema, [
      EffectSchema.Record(EffectSchema.String, EffectSchema.Unknown),
    ]),
    headers: EffectSchema.optionalKey(EffectSchema.Unknown),
    body: pullRequestActionRequestSchema,
  }),
);

export const pullRequestsContract = {
  pullRequest: read(PULL_REQUEST_PATH.PULL_REQUEST).output(
    EffectSchema.flip(agentPullRequestAnswerSchema),
  ),
  changes: read(PULL_REQUEST_PATH.CHANGES).output(EffectSchema.flip(agentChangesAnswerSchema)),
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
  viewed: read(PULL_REQUEST_PATH.VIEWED).output(EffectSchema.flip(pullRequestViewedAnswerSchema)),
  reviewOptions: read(PULL_REQUEST_PATH.REVIEW_OPTIONS).output(
    EffectSchema.flip(agentReviewOptionsAnswerSchema),
  ),
  overviewPullRequest: read(PULL_REQUEST_PATH.OVERVIEW_PULL_REQUEST).output(
    EffectSchema.flip(agentOverviewPullRequestAnswerSchema),
  ),
  overviewChecks: read(PULL_REQUEST_PATH.OVERVIEW_CHECKS).output(
    EffectSchema.flip(agentOverviewChecksAnswerSchema),
  ),
  overviewConversation: read(PULL_REQUEST_PATH.OVERVIEW_CONVERSATION).output(
    EffectSchema.flip(agentOverviewConversationAnswerSchema),
  ),
};
