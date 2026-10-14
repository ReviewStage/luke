import { Schema as EffectSchema } from "effect";
import {
  automationChangeRequestSchema,
  automationCreateRequestSchema,
  automationListAnswerSchema,
  automationRunAnswerSchema,
  automationRunsAnswerSchema,
  automationSummarySchema,
  webhookSecretSchema,
} from "./automation-wire.js";
import { wireUuidSchema } from "./service-wire.js";

/**
 * automation-view.ts -- the account's automations as one Mac's window hears them: each call's answer whole, or why there is none.
 *
 * The host asks the service on the window's behalf and answers the window
 * one of the shapes here. A webhook trigger's secret travels one way only:
 * the window mints it and names it in the params of the write that needs it,
 * into the host and on to the service, which keeps its hash; no answer here
 * carries one, so the window shows the secret it minted, once, and nothing
 * the Gateway answers holds it.
 */

/** Why an automation call answered nothing a window can draw. */
export const AUTOMATION_CALL_FAILURE = {
  /** The call never reached an answer: no credential, the network, a shape not read. */
  UNANSWERED: "unanswered",
  /** The automation, or the plan it names, is gone or not the account's. */
  NOT_FOUND: "not-found",
  /** The plan names no repository, so no agent could work on it. */
  NO_REPOSITORY: "no-repository",
  /** The service refused what was written: a schedule that does not read, a model it does not offer, or a trigger with no secret to rotate. */
  INVALID: "invalid",
} as const;

export type AutomationCallFailure =
  (typeof AUTOMATION_CALL_FAILURE)[keyof typeof AUTOMATION_CALL_FAILURE];

const failed = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(AUTOMATION_CALL_FAILURE)),
});

/** The list asked for: the account's automations, or one plan's. */
export const automationListParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.optionalKey(wireUuidSchema),
});

export type AutomationListParams = typeof automationListParamsSchema.Type;

/** An automation to make, its webhook secret the window's own where its trigger is a webhook. */
export const automationCreateParamsSchema = automationCreateRequestSchema;

export type AutomationCreateParams = typeof automationCreateParamsSchema.Type;

/** A change to one automation. */
export const automationChangeParamsSchema = EffectSchema.Struct({
  automationId: wireUuidSchema,
  change: automationChangeRequestSchema,
});

export type AutomationChangeParams = typeof automationChangeParamsSchema.Type;

/** One automation, by id. */
export const automationIdParamsSchema = EffectSchema.Struct({ automationId: wireUuidSchema });

export type AutomationIdParams = typeof automationIdParamsSchema.Type;

/** A "Run now" of one automation, under the window's own key. */
export const automationRunParamsSchema = EffectSchema.Struct({
  automationId: wireUuidSchema,
  idempotencyKey: wireUuidSchema,
});

export type AutomationRunParams = typeof automationRunParamsSchema.Type;

/** A webhook trigger's secret minted again, the window's own. */
export const automationWebhookSecretParamsSchema = EffectSchema.Struct({
  automationId: wireUuidSchema,
  webhookSecret: webhookSecretSchema,
});

export type AutomationWebhookSecretParams = typeof automationWebhookSecretParamsSchema.Type;

/** The account's automations as the window hears them. */
export const automationListViewSchema = EffectSchema.Union([automationListAnswerSchema, failed]);

export type AutomationListView = typeof automationListViewSchema.Type;

/** One automation as a write answers it to the window: the summary alone, never a secret. */
export const automationViewSchema = EffectSchema.Union([
  EffectSchema.Struct({
    automation: automationSummarySchema,
  }),
  failed,
]);

export type AutomationView = typeof automationViewSchema.Type;

/** A deletion as the window hears it. */
export const automationDeletedViewSchema = EffectSchema.Union([
  EffectSchema.Struct({ deleted: EffectSchema.Literal(true) }),
  failed,
]);

export type AutomationDeletedView = typeof automationDeletedViewSchema.Type;

/** The run a "Run now" made, as the window hears it. */
export const automationRunViewSchema = EffectSchema.Union([automationRunAnswerSchema, failed]);

export type AutomationRunView = typeof automationRunViewSchema.Type;

/** One automation's runs, as the window hears them. */
export const automationRunsViewSchema = EffectSchema.Union([automationRunsAnswerSchema, failed]);

export type AutomationRunsView = typeof automationRunsViewSchema.Type;
