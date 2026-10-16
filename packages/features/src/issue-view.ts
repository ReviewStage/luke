import { Schema as EffectSchema } from "effect";
import {
  issueAnswerSchema,
  issueChangeRequestSchema,
  issueCreateRequestSchema,
  issueListAnswerSchema,
} from "./issue-wire.js";
import { wireUuidSchema } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * issue-view.ts -- a workspace's issues as one Mac's window hears them: each call's answer whole, or why there is none.
 *
 * The host asks the service on the window's behalf and answers the window
 * one of the shapes here: the issues or the one issue the service answered,
 * or the one word for why there is none, which the window says and offers
 * to try again on.
 */

/** Why an issue call answered nothing a window can draw. */
export const ISSUE_CALL_FAILURE = {
  /** The call never reached an answer: no credential, the network, a shape not read. */
  UNANSWERED: "unanswered",
  /** The issue, or the workspace it names, is gone or not the account's to reach. */
  NOT_FOUND: "not-found",
  /** The service refused what was written: a title past its bound, or a change that names nothing. */
  INVALID: "invalid",
} as const;

export type IssueCallFailure = (typeof ISSUE_CALL_FAILURE)[keyof typeof ISSUE_CALL_FAILURE];

const failed = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(ISSUE_CALL_FAILURE)),
});

/** The list asked for: one workspace's issues, standing or archived. */
export const issueListParamsSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  archived: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type IssueListParams = typeof issueListParamsSchema.Type;

/** One issue, by id. */
export const issueIdParamsSchema = EffectSchema.Struct({ issueId: wireUuidSchema });

export type IssueIdParams = typeof issueIdParamsSchema.Type;

/** An issue to file, as the service takes it. */
export const issueCreateParamsSchema = issueCreateRequestSchema;

export type IssueCreateParams = typeof issueCreateParamsSchema.Type;

/** A change to one issue. */
export const issueChangeParamsSchema = EffectSchema.Struct({
  issueId: wireUuidSchema,
  change: issueChangeRequestSchema,
});

export type IssueChangeParams = typeof issueChangeParamsSchema.Type;

/** A workspace's issues as the window hears them. */
export const issueListViewSchema = EffectSchema.Union([issueListAnswerSchema, failed]);

export type IssueListView = typeof issueListViewSchema.Type;

/** One issue as a read or a write answers it to the window. */
export const issueViewSchema = EffectSchema.Union([issueAnswerSchema, failed]);

export type IssueView = typeof issueViewSchema.Type;
