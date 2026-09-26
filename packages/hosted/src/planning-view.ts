import { Schema as EffectSchema } from "effect";
import {
  GITHUB_FAILURE,
  type GitHubFailure,
  githubRepositoryListAnswerSchema,
} from "./github-wire.js";
import { planSchema, planSummarySchema } from "./plan-wire.js";

/**
 * planning-view.ts -- the named plans as one Mac holds them for its planning window: the list, the one active plan, and its saved document.
 *
 * The host reads the service for these and tells the desktop the whole view
 * whenever it moves; the desktop writes it into the document the planning
 * window draws from. Exactly one plan is ever active, the one the window has
 * open, and it is the plan a voice session binds to. The view carries plan
 * names, repositories, and documents and nothing of the account's GitHub
 * connection.
 */

/** Where one read of the service stands, as the window draws it. */
export const PLANNING_READ = {
  /** Nothing has been asked yet. */
  IDLE: "idle",
  /** Asked, and not yet answered. */
  READING: "reading",
  /** The last read landed; what it read is drawn. */
  READY: "ready",
  /** The last read did not land; the window offers to try again. */
  FAILED: "failed",
  /** The active plan is not one the account holds any more. */
  MISSING: "missing",
} as const;

const planningReadSchema = EffectSchema.Literals(Object.values(PLANNING_READ));

/**
 * The active plan's document as last read: the plan whole while a read has
 * landed, kept through a later read that failed, so the window never draws a
 * document it did not read and never drops one it did.
 */
const planningDocumentSchema = EffectSchema.Struct({
  status: planningReadSchema,
  plan: EffectSchema.optionalKey(planSchema),
});

export type PlanningDocument = typeof planningDocumentSchema.Type;

export const planningViewSchema = EffectSchema.Struct({
  /** The account's plans, most recently opened first, as the last list read answered. */
  plans: EffectSchema.Array(planSummarySchema),
  listStatus: planningReadSchema,
  /** The one active plan, absent while the window has none open. */
  activePlanId: EffectSchema.optionalKey(EffectSchema.String),
  document: planningDocumentSchema,
});

export type PlanningView = typeof planningViewSchema.Type;

/** The view before anything is asked: no plans read, none active. */
export const IDLE_PLANNING_VIEW: PlanningView = {
  plans: [],
  listStatus: PLANNING_READ.IDLE,
  document: { status: PLANNING_READ.IDLE },
};

/** Why a plan call answered nothing a window can draw. */
export const PLAN_CALL_FAILURE = {
  /** The call never reached an answer: no credential, the network, a refusal, a shape not read. */
  UNANSWERED: "unanswered",
  /** The plan is not one the account holds: deleted, or never the caller's. */
  NOT_FOUND: "not-found",
} as const;

export type PlanCallFailure = (typeof PLAN_CALL_FAILURE)[keyof typeof PLAN_CALL_FAILURE];

/** Why a call that goes through the account's GitHub connection answered nothing. */
export type GitHubCallFailure = GitHubFailure | typeof PLAN_CALL_FAILURE.UNANSWERED;

const githubCallFailureSchema = EffectSchema.Literals([
  ...Object.values(GITHUB_FAILURE),
  PLAN_CALL_FAILURE.UNANSWERED,
]);

/** Starting a plan, as the window hears it: the plan now active, or why none started. */
export const planningStartAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ planId: EffectSchema.String }),
  EffectSchema.Struct({ failure: githubCallFailureSchema }),
]);

export type PlanningStartAnswer = typeof planningStartAnswerSchema.Type;

/** The repository picker's list, or why the connection could not be read. */
export const planningRepositoriesAnswerSchema = EffectSchema.Union([
  githubRepositoryListAnswerSchema,
  EffectSchema.Struct({ failure: githubCallFailureSchema }),
]);

export type PlanningRepositoriesAnswer = typeof planningRepositoriesAnswerSchema.Type;
