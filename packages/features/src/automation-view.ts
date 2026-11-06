import { Schema as EffectSchema, Struct } from "effect";
import {
  automationChangeRequestSchema,
  automationCreateRequestSchema,
  automationDeletedAnswerSchema,
  automationRunAnswerSchema,
} from "./automation-wire.js";
import { automationsContract } from "./contract/automations.js";
import { answerView, failureSetOf } from "./hosted-failure.js";
import { HOSTED_API_ERROR, wireUuidSchema } from "./service-wire.js";

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

/**
 * The failures that shipped under a spelling other than their slug: a
 * request the service will not take is invalid, and GitHub not saying
 * whether a repository is reached is no answer, as it always read.
 */
export const AUTOMATION_RENAMES = {
  [HOSTED_API_ERROR.INVALID_REQUEST]: "invalid",
  [HOSTED_API_ERROR.GITHUB_UNANSWERED]: "unanswered",
} as const;

/** Why an automation call answered nothing a window can draw. */
export const AUTOMATION_CALL_FAILURE = failureSetOf(automationsContract, {
  as: AUTOMATION_RENAMES,
});

export type AutomationCallFailure =
  (typeof AUTOMATION_CALL_FAILURE)[keyof typeof AUTOMATION_CALL_FAILURE];

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
export const automationListViewSchema = answerView(automationsContract.list, {
  as: AUTOMATION_RENAMES,
});

export type AutomationListView = typeof automationListViewSchema.Type;

/** One automation as a write answers it to the window, with the webhook secret it minted where it minted one. */
export const automationViewSchema = answerView(automationsContract.change, {
  as: AUTOMATION_RENAMES,
});

export type AutomationView = typeof automationViewSchema.Type;

/** A deletion as the window hears it. */
export const automationDeletedViewSchema = EffectSchema.Union([
  EffectSchema.Struct({
    deleted: EffectSchema.Literal(true),
    txid: automationDeletedAnswerSchema.fields.txid,
  }),
  answerView(automationsContract.remove, { as: AUTOMATION_RENAMES }).members[1],
]);

export type AutomationDeletedView = typeof automationDeletedViewSchema.Type;

/** The run a "Run now" made, as the window hears it: the run, not the status it was answered with. */
export const automationRunViewSchema = EffectSchema.Union([
  automationRunAnswerSchema,
  answerView(automationsContract.run, { as: AUTOMATION_RENAMES }).members[1],
]);

export type AutomationRunView = typeof automationRunViewSchema.Type;

/** One automation's runs, as the window hears them. */
export const automationRunsViewSchema = answerView(automationsContract.runs, {
  as: AUTOMATION_RENAMES,
});

export type AutomationRunsView = typeof automationRunsViewSchema.Type;

/** What a window holds of the automations: one workspace's list, one automation's runs, or every run of one workspace's automations. */
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

/** One held list or history, by what it is of. */
export const automationFollowSchema = EffectSchema.Union([
  workspaceFollowSchema,
  runsFollowSchema,
  workspaceRunsFollowSchema,
]);

export type AutomationFollow = typeof automationFollowSchema.Type;
