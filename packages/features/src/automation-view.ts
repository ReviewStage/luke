import { Schema as EffectSchema, Struct } from "effect";
import {
  automationChangeRequestSchema,
  automationCreateRequestSchema,
  automationListAnswerSchema,
  automationRunAnswerSchema,
  automationRunsAnswerSchema,
  automationSummarySchema,
} from "./automation-wire.js";
import { repositoryUnreachedSchema } from "./repository-reach-wire.js";
import { wireUuidSchema } from "./service-wire.js";

/**
 * automation-view.ts -- the account's automations as one Mac's window hears them: each call's answer whole, or why there is none.
 *
 * The host asks the service on the window's behalf and answers the window
 * one of the shapes here. A repository the automation's workspace does not
 * reach is refused with why, as a Start is, so the window can say which
 * press mends it. The window writes any trigger. A webhook's secret is the
 * one secret an answer here carries, by root `AGENTS.md`'s carve-out: the
 * write that mints it, a webhook made or a new secret asked for, answers it
 * to the window that asked, once, for that window to show and forget; no
 * other answer, event, or window ever holds it.
 */

/** Why an automation call answered nothing a window can draw. */
export const AUTOMATION_CALL_FAILURE = {
  /** The call never reached an answer: no credential, the network, a shape not read. */
  UNANSWERED: "unanswered",
  /** The automation, or the task or workspace it names, is gone or not the account's to reach. */
  NOT_FOUND: "not-found",
  /** The task it stands on names no repository, so no agent could work on it. */
  NO_REPOSITORY: "no-repository",
  /** A repository it names is one its workspace's installation does not reach. */
  REPOSITORY_NOT_REACHABLE: "repository-not-reachable",
  /** The service refused what was written: a schedule that does not read, a model it does not offer, or a place it cannot stand on. */
  INVALID: "invalid",
  /** The account may read it but not do this with it: a teammate's personal automation, or a workspace one only its owners and admins change. */
  NOT_PERMITTED: "not-permitted",
} as const;

export type AutomationCallFailure =
  (typeof AUTOMATION_CALL_FAILURE)[keyof typeof AUTOMATION_CALL_FAILURE];

const failed = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(AUTOMATION_CALL_FAILURE)),
  /** Why the repository is out of reach, where that is the failure and the service said. */
  unreached: EffectSchema.optionalKey(repositoryUnreachedSchema),
});

/** The list asked for: the account's automations, or one task's, or one workspace's. */
export const automationListParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.optionalKey(wireUuidSchema),
  workspaceId: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
});

export type AutomationListParams = typeof automationListParamsSchema.Type;

/** An automation to make, as the service takes it. */
export const automationCreateParamsSchema = automationCreateRequestSchema;

export type AutomationCreateParams = typeof automationCreateParamsSchema.Type;

/** A change to one automation. A webhook's secret is replaced by the copy's own ask, never a change's. */
export const automationChangeParamsSchema = EffectSchema.Struct({
  automationId: wireUuidSchema,
  change: automationChangeRequestSchema.mapFields(Struct.omit(["webhookSecretHash"])),
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

/** The account's automations as the window hears them. */
export const automationListViewSchema = EffectSchema.Union([automationListAnswerSchema, failed]);

export type AutomationListView = typeof automationListViewSchema.Type;

/** One automation as a write answers it to the window, with the webhook secret it minted where it minted one. */
export const automationViewSchema = EffectSchema.Union([
  EffectSchema.Struct({
    automation: automationSummarySchema,
    webhookSecret: EffectSchema.optionalKey(EffectSchema.String),
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
