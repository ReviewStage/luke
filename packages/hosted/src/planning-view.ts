import { Schema as EffectSchema } from "effect";
import { boardSaveRequestSchema, boardSchema } from "./board-wire.js";
import {
  githubRepositoriesAnswerSchema,
  githubRepositoryFullNameSchema,
} from "./github-repositories-wire.js";
import {
  codeRefSchema,
  planCreateRequestSchema,
  planRenameRequestSchema,
  planSchema,
  planSummarySchema,
} from "./plan-wire.js";
import { planTranscriptSchema } from "./transcript-wire.js";

/**
 * planning-view.ts -- the named plans as one Mac holds them for its panel's Plans tab: the list, the one active plan, and its saved document.
 *
 * The host reads the service for these and tells the desktop the whole view
 * whenever it moves; the desktop writes it into the document the planning
 * window draws from. Exactly one plan is ever active, the one the window has
 * open, and it is the plan a voice session binds to. The view carries plan
 * names, documents, and what was said on the active plan's calls from the
 * service, and nothing of this Mac's own: a plan's repository is the
 * service's, named on the plan itself.
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

/**
 * What was said on the active plan's calls as last read, kept through a
 * later read that failed, as the document is. The call standing now is not
 * in it until the call ends and the transcript is read again: its words so
 * far are the voice window's to report.
 */
const planningTranscriptSchema = EffectSchema.Struct({
  status: planningReadSchema,
  transcript: EffectSchema.optionalKey(planTranscriptSchema),
});

/**
 * The two waits on the voice side that no live status names: the voice model
 * delegated an ask the planning model has not yet taken, or words are queued
 * for Luke that his voice has not begun to say.
 */
export const VOICE_PHASE = {
  HANDING_OFF: "handing_off",
  ABOUT_TO_ANSWER: "about_to_answer",
} as const;

export type VoicePhase = (typeof VOICE_PHASE)[keyof typeof VOICE_PHASE];

/** The most of the planning model's pending command an activity carries; the service cuts it there. */
export const PLAN_ACTIVITY_ACTION_MAX_CHARS = 120;

/**
 * What each part of Luke is doing on a planning call, whole, as the service's
 * `plan.activity` frame says it: the voice's wait where it is in one, the
 * planning model while it works on an ask with the command it is running
 * where one is pending, and whether the notetaker is writing. Nothing of the
 * ask, and no tool's output.
 */
export const planActivitySchema = EffectSchema.Struct({
  voice: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(VOICE_PHASE))),
  planner: EffectSchema.optionalKey(
    EffectSchema.Struct({
      action: EffectSchema.optionalKey(
        EffectSchema.String.check(EffectSchema.isMaxLength(PLAN_ACTIVITY_ACTION_MAX_CHARS)),
      ),
    }),
  ),
  notes: EffectSchema.Boolean,
});

export type PlanActivity = typeof planActivitySchema.Type;

/** One run of a line in one colour, as the host's highlighter split it. */
const codeTokenSchema = EffectSchema.Struct({
  text: EffectSchema.String,
  /** A `#rrggbb` colour; absent for the theme's own foreground. */
  color: EffectSchema.optionalKey(EffectSchema.String),
});

export type CodeToken = typeof codeTokenSchema.Type;

/**
 * The code on screen during the call about the active plan: what Luke named,
 * the repository the service read it from, and the file's lines as they
 * arrived and this Mac coloured them, the window's first line first. It
 * stands for the call alone: nothing of it enters the plan.
 */
const planCodeSchema = EffectSchema.Struct({
  ref: codeRefSchema,
  /** The repository the lines were read from, `owner/name`. */
  repository: EffectSchema.String,
  /** The file's line the first drawn line is; the screen holds a window of a long file around the lines pointed at. */
  firstLine: EffectSchema.Int,
  /** How many lines the whole file has. */
  lineCount: EffectSchema.Int,
  lines: EffectSchema.Array(EffectSchema.Array(codeTokenSchema)),
});

export type PlanCode = typeof planCodeSchema.Type;

export const planningViewSchema = EffectSchema.Struct({
  /** The account's plans, newest started first, as the last list read answered. */
  plans: EffectSchema.Array(planSummarySchema),
  listStatus: planningReadSchema,
  /** The one active plan, absent while the window has none open. */
  activePlanId: EffectSchema.optionalKey(EffectSchema.String),
  document: planningDocumentSchema,
  /** What each part of Luke is doing on the call about the active plan, as last told; absent with no plan open or no word yet. */
  activity: EffectSchema.optionalKey(planActivitySchema),
  /** The active plan's whiteboard as last read or saved; absent with no plan open or before its first read lands. */
  board: EffectSchema.optionalKey(boardSchema),
  /** What was said on the active plan's calls as last read; absent with no plan open. */
  transcript: EffectSchema.optionalKey(planningTranscriptSchema),
  /** The code on screen during the call about the active plan; absent with none, and cleared with the activity. */
  code: EffectSchema.optionalKey(planCodeSchema),
});

export type PlanningView = typeof planningViewSchema.Type;

/** The view before anything is asked: no plans read, none active. */
export const IDLE_PLANNING_VIEW: PlanningView = {
  plans: [],
  listStatus: PLANNING_READ.IDLE,
  document: { status: PLANNING_READ.IDLE },
};

/** Starting a plan, as the window asks it: the name, and the repository it is about where one is chosen; the service keeps both. */
export const planningStartRequestSchema = planCreateRequestSchema;

export type PlanningStartRequest = typeof planningStartRequestSchema.Type;

/** Renaming a plan, as the window asks it: the plan, and the name the service keeps. */
export const planningRenameParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  ...planRenameRequestSchema.fields,
});

export type PlanningRenameParams = typeof planningRenameParamsSchema.Type;

/** Giving a plan its repository, or taking it away: the plan, and the repository's full name or null for none. */
export const planningSetRepositoryParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  repository: EffectSchema.NullOr(githubRepositoryFullNameSchema),
});

export type PlanningSetRepositoryParams = typeof planningSetRepositoryParamsSchema.Type;

/** A plan's board as the panel asks it saved: the whole scene, and the number of Luke's drawing it holds. */
export const planningBoardSaveParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  ...boardSaveRequestSchema.fields,
});

export type PlanningBoardSaveParams = typeof planningBoardSaveParamsSchema.Type;

/** Why a plan call answered nothing a window can draw. */
export const PLAN_CALL_FAILURE = {
  /** The call never reached an answer: no credential, the network, a refusal, a shape not read. */
  UNANSWERED: "unanswered",
  /** The plan is not one the account holds: deleted, or never the caller's. */
  NOT_FOUND: "not-found",
  /** The repository named is not one the Luke GitHub App reaches for the account. */
  REPOSITORY_NOT_REACHABLE: "repository-not-reachable",
  /** The account must sign in with GitHub again before the service can read GitHub for it. */
  GITHUB_SIGN_IN_REQUIRED: "github-sign-in-required",
} as const;

export type PlanCallFailure = (typeof PLAN_CALL_FAILURE)[keyof typeof PLAN_CALL_FAILURE];

/** Why a call that names a repository answered nothing: the service did not answer, or GitHub's reach refused it. */
const REPOSITORY_CALL_FAILURES = [
  PLAN_CALL_FAILURE.UNANSWERED,
  PLAN_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
  PLAN_CALL_FAILURE.GITHUB_SIGN_IN_REQUIRED,
] as const;

export type RepositoryCallFailure = (typeof REPOSITORY_CALL_FAILURES)[number];

const repositoryCallFailureSchema = EffectSchema.Literals(REPOSITORY_CALL_FAILURES);

/** Starting a plan, as the window hears it: the plan now active, or why none started. */
export const planningStartAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ planId: EffectSchema.String }),
  EffectSchema.Struct({ failure: repositoryCallFailureSchema }),
]);

export type PlanningStartAnswer = typeof planningStartAnswerSchema.Type;

/** Why the repository list answered nothing: the service did not answer, or the account must sign in with GitHub again. */
const REPOSITORY_LIST_FAILURES = [
  PLAN_CALL_FAILURE.UNANSWERED,
  PLAN_CALL_FAILURE.GITHUB_SIGN_IN_REQUIRED,
] as const;

export type RepositoryListFailure = (typeof REPOSITORY_LIST_FAILURES)[number];

/** The repositories the account reaches, as the window hears them: the service's answer whole, or why there is none. */
export const planningRepositoriesAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ repositories: githubRepositoriesAnswerSchema }),
  EffectSchema.Struct({ failure: EffectSchema.Literals(REPOSITORY_LIST_FAILURES) }),
]);

export type PlanningRepositoriesAnswer = typeof planningRepositoriesAnswerSchema.Type;

/** A plan's repository changed, as the window hears it: the repository the plan now names, or why it is unchanged. */
export const planningSetRepositoryAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ repository: EffectSchema.NullOr(EffectSchema.String) }),
  EffectSchema.Struct({ failure: repositoryCallFailureSchema }),
]);

export type PlanningSetRepositoryAnswer = typeof planningSetRepositoryAnswerSchema.Type;
