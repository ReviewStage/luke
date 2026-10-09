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

/** How far a planning turn, or one call inside it, has got. */
export const PLAN_WORK_STATE = {
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
} as const;

export type PlanWorkState = (typeof PLAN_WORK_STATE)[keyof typeof PLAN_WORK_STATE];

/**
 * Which of the planning model's tools a call is, so the Work tab can say it
 * in words: one kind per tool the planning turn is offered, and `other` for
 * a tool a newer service offers that this vocabulary does not name yet.
 */
export const PLAN_WORK_TOOL = {
  REPOSITORY: "repository",
  SEARCH_WEB: "search-web",
  READ_WEB_PAGE: "read-web-page",
  SHOW_CODE: "show-code",
  DRAW_ON_BOARD: "draw-on-board",
  LOOK_AT_BOARD: "look-at-board",
  QUEUE_QUESTION: "queue-question",
  WORKER: "worker",
  WORKER_WAIT: "worker-wait",
  WORKER_CANCEL: "worker-cancel",
  OTHER: "other",
} as const;

export type PlanWorkTool = (typeof PLAN_WORK_TOOL)[keyof typeof PLAN_WORK_TOOL];

/** The kinds of part a turn's work is made of, in the order the model wrote them. */
export const PLAN_WORK_PART = {
  TEXT: "text",
  REASONING: "reasoning",
  TOOL: "tool",
} as const;

/**
 * How much of a turn one `plan.work` frame carries. The newest parts are
 * kept, and each text, input, and output is cut to its bound, so a turn
 * that read a large file still travels in a frame of tens of kilobytes.
 */
export const PLAN_WORK_BOUNDS = {
  /** The most turns of the open plan's calls the view keeps, the newest. */
  TURNS: 20,
  PARTS: 60,
  TEXT_CHARS: 4_000,
  SUBJECT_CHARS: 300,
  NAME_CHARS: 64,
} as const;

const workText = EffectSchema.String.check(EffectSchema.isMaxLength(PLAN_WORK_BOUNDS.TEXT_CHARS));

const planWorkTextPartSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(PLAN_WORK_PART.TEXT),
  text: workText,
});

const planWorkReasoningPartSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(PLAN_WORK_PART.REASONING),
  text: workText,
});

/**
 * One call the planning model made: which tool, by kind and by name; its
 * state; the one input a reader looks for first (the command, the query, the
 * page, the file), as its subject; and the whole input and output as text,
 * each cut to its bound.
 */
const planWorkToolPartSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(PLAN_WORK_PART.TOOL),
  id: EffectSchema.String,
  tool: EffectSchema.Literals(Object.values(PLAN_WORK_TOOL)),
  name: EffectSchema.String.check(EffectSchema.isMaxLength(PLAN_WORK_BOUNDS.NAME_CHARS)),
  state: EffectSchema.Literals(Object.values(PLAN_WORK_STATE)),
  subject: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(PLAN_WORK_BOUNDS.SUBJECT_CHARS)),
  ),
  input: workText,
  output: EffectSchema.optionalKey(workText),
});

/** What a subagent's session is made of: its words, its reasoning, and its calls, none of which starts a subagent of its own. */
const planWorkSessionPartSchema = EffectSchema.Union([
  planWorkTextPartSchema,
  planWorkReasoningPartSchema,
  planWorkToolPartSchema,
]);

/**
 * A subagent's session as the Work tab draws it: the newest of what it
 * wrote and called, oldest first, in the same parts as the planning
 * model's. Note that it stands one level deep, because the wire shows no
 * recursive declaration and no subagent is offered a subagent of its own.
 */
const planWorkSessionSchema = EffectSchema.Struct({
  /** Whether older parts than these were left out. */
  earlierOmitted: EffectSchema.Boolean,
  parts: EffectSchema.Array(planWorkSessionPartSchema),
});

const planWorkPartSchema = EffectSchema.Union([
  planWorkTextPartSchema,
  planWorkReasoningPartSchema,
  EffectSchema.Struct({
    ...planWorkToolPartSchema.fields,
    /** For a call that started a subagent, the subagent's own session as far as it has got; absent for any other call. */
    session: EffectSchema.optionalKey(planWorkSessionSchema),
  }),
]);

export type PlanWorkPart = typeof planWorkPartSchema.Type;

/**
 * One planning turn as the Work tab draws it: the turn, when it started,
 * how far it has got, and the newest of what the model wrote and called,
 * oldest first. Unlike `plan.activity`, this carries each call's output: the
 * text a command answered in the plan's repository sandbox, and pages read
 * from the public web, shown back to the developer on their own Mac.
 */
export const planWorkTurnSchema = EffectSchema.Struct({
  turnId: EffectSchema.String,
  /** Epoch milliseconds the turn started. */
  startedAt: EffectSchema.Finite,
  state: EffectSchema.Literals(Object.values(PLAN_WORK_STATE)),
  /** Whether older parts than these were left out. */
  earlierOmitted: EffectSchema.Boolean,
  parts: EffectSchema.Array(planWorkPartSchema),
});

export type PlanWorkTurn = typeof planWorkTurnSchema.Type;

/** One run of a line in one colour per appearance, as the host's highlighter split it. */
const codeTokenSchema = EffectSchema.Struct({
  text: EffectSchema.String,
  /** A `#rrggbb` colour in the dark theme; absent for that theme's own foreground. */
  color: EffectSchema.optionalKey(EffectSchema.String),
  /** A `#rrggbb` colour in the light theme; absent for that theme's own foreground. */
  lightColor: EffectSchema.optionalKey(EffectSchema.String),
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
  /**
   * The planning turns of the active plan's calls since it was opened on
   * this Mac, oldest first, each as last told; absent before the first, and
   * cleared with the activity. A call's end keeps them.
   */
  work: EffectSchema.optionalKey(EffectSchema.Array(planWorkTurnSchema)),
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
