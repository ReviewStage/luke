import { Schema as EffectSchema, Struct } from "effect";
import {
  automationChangeRequestSchema,
  automationCreateRequestSchema,
  automationDeletedAnswerSchema,
  automationListAnswerSchema,
  automationRunAnswerSchema,
  automationRunsAnswerSchema,
  automationSummarySchema,
} from "./automation-wire.js";
import { repositoryUnreachedSchema } from "./repository-reach-wire.js";
import { wireUuidSchema } from "./service-wire.js";

export const AUTOMATION_CALL_FAILURE = {
  UNANSWERED: "unanswered",
  NOT_FOUND: "not-found",
  NO_REPOSITORY: "no-repository",
  REPOSITORY_NOT_REACHABLE: "repository-not-reachable",
  INVALID: "invalid",
  NOT_PERMITTED: "not-permitted",
} as const;

export type AutomationCallFailure =
  (typeof AUTOMATION_CALL_FAILURE)[keyof typeof AUTOMATION_CALL_FAILURE];

const failed = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(AUTOMATION_CALL_FAILURE)),
  unreached: EffectSchema.optionalKey(repositoryUnreachedSchema),
});

export const automationListParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.optionalKey(wireUuidSchema),
  workspaceId: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
});

export type AutomationListParams = typeof automationListParamsSchema.Type;

export const automationCreateParamsSchema = automationCreateRequestSchema;

export type AutomationCreateParams = typeof automationCreateParamsSchema.Type;

export const automationChangeParamsSchema = EffectSchema.Struct({
  automationId: wireUuidSchema,
  change: automationChangeRequestSchema.mapFields(Struct.omit(["webhookSecretHash"])),
});

export type AutomationChangeParams = typeof automationChangeParamsSchema.Type;

export const automationIdParamsSchema = EffectSchema.Struct({ automationId: wireUuidSchema });

export type AutomationIdParams = typeof automationIdParamsSchema.Type;

export const automationRunParamsSchema = EffectSchema.Struct({
  automationId: wireUuidSchema,
  idempotencyKey: wireUuidSchema,
});

export type AutomationRunParams = typeof automationRunParamsSchema.Type;

export const automationListViewSchema = EffectSchema.Union([automationListAnswerSchema, failed]);

export type AutomationListView = typeof automationListViewSchema.Type;

export const automationViewSchema = EffectSchema.Union([
  EffectSchema.Struct({
    automation: automationSummarySchema,
    webhookSecret: EffectSchema.optionalKey(EffectSchema.String),
    txid: automationDeletedAnswerSchema.fields.txid,
  }),
  failed,
]);

export type AutomationView = typeof automationViewSchema.Type;

export const automationDeletedViewSchema = EffectSchema.Union([
  EffectSchema.Struct({
    deleted: EffectSchema.Literal(true),
    txid: automationDeletedAnswerSchema.fields.txid,
  }),
  failed,
]);

export type AutomationDeletedView = typeof automationDeletedViewSchema.Type;

export const automationRunViewSchema = EffectSchema.Union([automationRunAnswerSchema, failed]);

export type AutomationRunView = typeof automationRunViewSchema.Type;

export const automationRunsViewSchema = EffectSchema.Union([automationRunsAnswerSchema, failed]);

export type AutomationRunsView = typeof automationRunsViewSchema.Type;

export const AUTOMATION_FOLLOW = {
  WORKSPACE: "workspace",
  RUNS: "runs",
  WORKSPACE_RUNS: "workspaceRuns",
} as const;

const workspaceFollowSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(AUTOMATION_FOLLOW.WORKSPACE),
  id: EffectSchema.NonEmptyString,
});

const runsFollowSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(AUTOMATION_FOLLOW.RUNS),
  id: wireUuidSchema,
});

const workspaceRunsFollowSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(AUTOMATION_FOLLOW.WORKSPACE_RUNS),
  id: EffectSchema.NonEmptyString,
});

export const automationFollowSchema = EffectSchema.Union([
  workspaceFollowSchema,
  runsFollowSchema,
  workspaceRunsFollowSchema,
]);

export type AutomationFollow = typeof automationFollowSchema.Type;
