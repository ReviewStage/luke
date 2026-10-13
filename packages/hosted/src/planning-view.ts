import { Schema as EffectSchema } from "effect";
import { boardSaveRequestSchema, boardSchema } from "./board-wire.js";
import { CODING_AGENT_BOUNDS, turnRecordFields } from "./coding-agent-wire.js";
import {
  githubRepositoriesAnswerSchema,
  githubRepositoryFullNameSchema,
} from "./github-repositories-wire.js";
import { pageVersionNumberSchema, planPageVersionAnswerSchema } from "./page-wire.js";
import { PLAN_EDIT_REFUSAL, planEditRequestSchema, planEditValueSchema } from "./plan-edit.js";
import {
  codeRefSchema,
  planCreateRequestSchema,
  planFileRefusalSchema,
  planFileRequestSchema,
  planFileTextSchema,
  planRenameRequestSchema,
  planRevisionAnswerSchema,
  planRevisionSeqSchema,
  planRevisionsAnswerSchema,
  planSchema,
  planSkillsSchema,
  planSummarySchema,
  planTreeFolderSchema,
  planTreeRequestSchema,
  repositoryPinRequestSchema,
  repositoryPinSchema,
  shownCodeSchema,
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
  WITHDRAW_QUESTION: "withdraw-question",
  WORKER: "worker",
  WORKER_WAIT: "worker-wait",
  WORKER_CANCEL: "worker-cancel",
  LIST_AGENTS: "list-agents",
  READ_AGENT: "read-agent",
  MESSAGE_AGENT: "message-agent",
  START_AGENT: "start-agent",
  END_CALL: "end-call",
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
  /** The most turns one read of a plan's work carries, the newest before where it began; older ones are read a page at a time. */
  TURNS: 20,
  PARTS: 60,
  TEXT_CHARS: 4_000,
  SUBJECT_CHARS: 300,
  NAME_CHARS: 64,
  /** The most spoken lines one turn names as its ask. */
  ASKED_LINES: 20,
  /** The most characters of a spoken line's id, which the voice's ledger mints. */
  LINE_ID_CHARS: 128,
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
 * page, the file), as its subject; the subagent task it started, sent work
 * to, or stopped; and the whole input and output as text, each cut to its
 * bound.
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
  /** The subagent task a `worker` call started or sent work to, or a `worker-cancel` call stopped, by eve's id for it, so the stop names the subagent it stopped; absent for any other call, before a start answered, and from a service older than it. */
  task: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(PLAN_WORK_BOUNDS.NAME_CHARS)),
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
 * model's, when its newest task began and ended, its title, and what that
 * task ran on and spent. Note that it stands one level deep, because the wire shows no
 * recursive declaration and no subagent is offered a subagent of its own.
 */
const planWorkSessionSchema = EffectSchema.Struct({
  /** Whether older parts than these were left out. */
  earlierOmitted: EffectSchema.Boolean,
  parts: EffectSchema.Array(planWorkSessionPartSchema),
  /** Epoch milliseconds the subagent began its newest task, which a running one counts from; absent from a service older than it. */
  startedAt: EffectSchema.optionalKey(EffectSchema.Finite),
  /** Epoch milliseconds it answered or ended that task; absent while it runs, and from a service older than it. */
  endedAt: EffectSchema.optionalKey(EffectSchema.Finite),
  /** Its short title, generated from the first task it was handed; absent until that lands, where none could be generated, and from a service older than it. */
  title: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(CODING_AGENT_BOUNDS.MAX_TITLE_CHARS)),
  ),
  /** What its newest task ran on, which its row names as an agent's subagent row names its pair, and once it ended what it spent and how it ended. */
  ...turnRecordFields,
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
 * One planning turn as the Work tab draws it: the turn, when it started and
 * ended, how far it has got, the newest of what the model wrote and called,
 * oldest first, and what it ran on and spent. Unlike `plan.activity`, this
 * carries each call's output: the text a command answered in the plan's
 * repository sandbox, and pages read from the public web, shown back to the
 * developer on their own Mac.
 */
export const planWorkTurnSchema = EffectSchema.Struct({
  turnId: EffectSchema.String,
  /** Epoch milliseconds the turn started. */
  startedAt: EffectSchema.Finite,
  /** Epoch milliseconds the turn ended; absent while it runs, and from a service older than it. */
  endedAt: EffectSchema.optionalKey(EffectSchema.Finite),
  state: EffectSchema.Literals(Object.values(PLAN_WORK_STATE)),
  /** Whether older parts than these were left out. */
  earlierOmitted: EffectSchema.Boolean,
  parts: EffectSchema.Array(planWorkPartSchema),
  /**
   * The developer's spoken lines the turn took as its ask, by the ids the
   * Transcript names them by, in the order they were said; absent for a turn
   * no spoken line opened, before its lines are taken into it, and from a
   * service older than it.
   */
  asked: EffectSchema.optionalKey(
    EffectSchema.Array(
      EffectSchema.String.check(EffectSchema.isMaxLength(PLAN_WORK_BOUNDS.LINE_ID_CHARS)),
    ).check(EffectSchema.isMaxLength(PLAN_WORK_BOUNDS.ASKED_LINES)),
  ),
  ...turnRecordFields,
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

/** Lines of code as the host coloured them, each a line's runs in order. */
export const codeLinesSchema = EffectSchema.Array(EffectSchema.Array(codeTokenSchema));

export type CodeLines = typeof codeLinesSchema.Type;

/**
 * One code Luke showed on the active plan: what he named, the repository
 * the service read it from, the file's lines as they arrived and this
 * Mac coloured them, the window's first line first, and his note on them. Nothing of it enters
 * the plan's document.
 */
const planCodeSchema = EffectSchema.Struct({
  ref: codeRefSchema,
  /** The repository the lines were read from, `owner/name`. */
  repository: EffectSchema.String,
  /** The commit the checkout stood at when the lines were read; absent on code shown before it was recorded. */
  commit: EffectSchema.optionalKey(EffectSchema.String),
  /** The file's line the first drawn line is; the screen holds a window of a long file around the lines pointed at. */
  firstLine: EffectSchema.Int,
  /** How many lines the whole file has. */
  lineCount: EffectSchema.Int,
  lines: codeLinesSchema,
  /** What Luke said the lines are for; absent on code shown before notes were asked for. */
  note: EffectSchema.optionalKey(EffectSchema.String),
});

export type PlanCode = typeof planCodeSchema.Type;

/**
 * One code Luke showed on a plan: the `show_code` call that showed it, the
 * turn it ran in and when that turn began writing, and the place and lines
 * as the call answered them.
 */
const planShownCodeFields = {
  callId: EffectSchema.String,
  turnId: EffectSchema.String,
  /** Epoch milliseconds the turn that showed it began. */
  shownAt: EffectSchema.Finite,
};

export const planShownCodeSchema = EffectSchema.Struct({
  ...planShownCodeFields,
  code: shownCodeSchema,
});

export type PlanShownCode = typeof planShownCodeSchema.Type;

/**
 * One code shown on the active plan as the Code tab draws it: the call that
 * showed it, its turn and when that began, and the lines coloured.
 */
const planCodeShowingSchema = EffectSchema.Struct({
  ...planShownCodeFields,
  code: planCodeSchema,
});

export type PlanCodeShowing = typeof planCodeShowingSchema.Type;

/**
 * A plan's work as the service keeps it (GET `/api/plans/{id}/work`, with
 * `before` naming a turn for an older page): a page of the planning turns of
 * its calls, the newest before where the read began, oldest first, each as
 * a `plan.work` frame would tell it, and the turn to read before for the
 * page older than this one. The newest page also carries every code Luke
 * showed on the plan, oldest first, with the lines each `show_code` call
 * answered, several of one file included. It is what the Work and Code tabs
 * draw when a plan opens, after a restart or a switch from another plan,
 * before any call about it tells more.
 */
export const planWorkAnswerSchema = EffectSchema.Struct({
  turns: EffectSchema.Array(planWorkTurnSchema),
  /** The turn the next older page is read before; absent where no older turn stands. */
  earlier: EffectSchema.optionalKey(EffectSchema.String),
  /** Every code shown on the plan, oldest first; carried on the newest page alone. */
  code: EffectSchema.optionalKey(EffectSchema.Array(planShownCodeSchema)),
});

export type PlanWorkAnswer = typeof planWorkAnswerSchema.Type;

export const planningViewSchema = EffectSchema.Struct({
  /** The account's plans, newest started first, as the last list read answered. */
  plans: EffectSchema.Array(planSummarySchema),
  listStatus: planningReadSchema,
  /** The repositories the account pinned in the sidebar, newest pinned first, as last read or pinned; absent before the first read lands. */
  repositoryPins: EffectSchema.optionalKey(EffectSchema.Array(repositoryPinSchema)),
  /** The one active plan, absent while the window has none open. */
  activePlanId: EffectSchema.optionalKey(EffectSchema.String),
  document: planningDocumentSchema,
  /** What each part of Luke is doing on the call about the active plan, as last told; absent with no plan open or no word yet. */
  activity: EffectSchema.optionalKey(planActivitySchema),
  /**
   * What each part of Luke is doing on the standing call, whichever plan it
   * is about, as last told: what the floating call window draws while the
   * call's plan is not the one open. Absent before the first word and once
   * the call has ended.
   */
  callActivity: EffectSchema.optionalKey(planActivitySchema),
  /** The active plan's whiteboard as last read or saved; absent with no plan open or before its first read lands. */
  board: EffectSchema.optionalKey(boardSchema),
  /** What was said on the active plan's calls as last read; absent with no plan open. */
  transcript: EffectSchema.optionalKey(planningTranscriptSchema),
  /**
   * Every code Luke showed on the active plan, oldest first, several of one
   * file included: what the plan's work holds, read with the newest page,
   * and each code a call shows since, by its call, so a call's code and
   * the record's copy of it stand once; absent with none, and cleared with
   * the activity. A call's end keeps them.
   */
  shownCode: EffectSchema.optionalKey(EffectSchema.Array(planCodeShowingSchema)),
  /**
   * The planning turns of the active plan's calls, oldest first: the newest
   * page read from the service when the plan opens, each older page read as
   * the Work tab scrolls back, and each turn a call tells since as last
   * told; absent before the first, and cleared with the activity. A call's
   * end keeps them.
   */
  work: EffectSchema.optionalKey(EffectSchema.Array(planWorkTurnSchema)),
  /** The turn the active plan's next older page of work is read before; absent where none stands or before the first read. */
  workEarlier: EffectSchema.optionalKey(EffectSchema.String),
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

/** Pinning a plan, or unpinning it, as the window asks it. */
export const planningPinParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  pinned: EffectSchema.Boolean,
});

export type PlanningPinParams = typeof planningPinParamsSchema.Type;

/** Pinning a repository in the sidebar, or unpinning it, as the window asks it; the service keeps it on the account. */
export const planningPinRepositoryParamsSchema = repositoryPinRequestSchema;

export type PlanningPinRepositoryParams = typeof planningPinRepositoryParamsSchema.Type;

/** Archiving a plan, or bringing it back, as the window asks it. */
export const planningArchiveParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  archived: EffectSchema.Boolean,
});

export type PlanningArchiveParams = typeof planningArchiveParamsSchema.Type;

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
  /** The plan is archived, so it takes no write until it is brought back. */
  PLAN_ARCHIVED: "plan-archived",
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

/** The developer's edit of a plan's document, as the window asks it saved: the plan, and the edit as the service takes it. */
export const planningEditParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  edit: planEditRequestSchema,
});

export type PlanningEditParams = typeof planningEditParamsSchema.Type;

/** Why an edit saved nothing: the service did not answer, the plan is gone or archived, or the plan would be longer than a plan may be. */
const EDIT_FAILURES = [
  PLAN_CALL_FAILURE.UNANSWERED,
  PLAN_CALL_FAILURE.NOT_FOUND,
  PLAN_CALL_FAILURE.PLAN_ARCHIVED,
  PLAN_EDIT_REFUSAL.TOO_LONG,
] as const;

export type PlanningEditFailure = (typeof EDIT_FAILURES)[number];

/**
 * An edit as the window hears it: saved, the plan arriving on the document
 * as the service answered it; a conflict, with what the field holds now; or
 * why nothing was saved.
 */
export const planningEditAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ saved: EffectSchema.Literal(true) }),
  EffectSchema.Struct({ conflict: EffectSchema.Struct({ current: planEditValueSchema }) }),
  EffectSchema.Struct({ failure: EffectSchema.Literals(EDIT_FAILURES) }),
]);

export type PlanningEditAnswer = typeof planningEditAnswerSchema.Type;

/** A window of a file of a plan's repository, as the File tab asks the host for it: the plan, the path, and the window's first and last line. */
export const planningFileParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  ...planFileRequestSchema.fields,
});

export type PlanningFileParams = typeof planningFileParamsSchema.Type;

/** A window of a file as the File tab draws it: its place and the branch it was read on, how long the whole file is, and its lines as this Mac coloured them. */
const planFileShownSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  repository: EffectSchema.String,
  branch: EffectSchema.String,
  firstLine: EffectSchema.Int,
  lineCount: EffectSchema.Int,
  lines: codeLinesSchema,
});

export type PlanFileShown = typeof planFileShownSchema.Type;

/** The File tab's read, as the window hears it: the window coloured, the whole text read raw, why the file is not shown, or that the service did not answer. */
export const planningFileAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ file: planFileShownSchema }),
  EffectSchema.Struct({ text: planFileTextSchema }),
  planFileRefusalSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(PLAN_CALL_FAILURE.UNANSWERED) }),
]);

export type PlanningFileAnswer = typeof planningFileAnswerSchema.Type;

/** One folder of a plan's repository, as the File tab's tree asks the host for it: the plan, and the folder's path from the root. */
export const planningTreeParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  ...planTreeRequestSchema.fields,
});

export type PlanningTreeParams = typeof planningTreeParamsSchema.Type;

/** The tree's read of a folder, as the window hears it: the folder listed, why it is not, or that the service did not answer. */
export const planningTreeAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ folder: planTreeFolderSchema }),
  planFileRefusalSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(PLAN_CALL_FAILURE.UNANSWERED) }),
]);

export type PlanningTreeAnswer = typeof planningTreeAnswerSchema.Type;

/** The skills a developer may choose of a plan's repository, as the window asks the host for them: the plan. */
export const planningSkillsParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
});

export type PlanningSkillsParams = typeof planningSkillsParamsSchema.Type;

/** The read of a repository's skills, as the window hears it: the skills, why they are not read, or that the service did not answer. */
export const planningSkillsAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ skills: planSkillsSchema }),
  planFileRefusalSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(PLAN_CALL_FAILURE.UNANSWERED) }),
]);

export type PlanningSkillsAnswer = typeof planningSkillsAnswerSchema.Type;

/** A page of a plan's history, as the version history asks the host for it: the plan, and the revision the page is read before where it is an older page. */
export const planningRevisionsParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  before: EffectSchema.optionalKey(planRevisionSeqSchema),
});

export type PlanningRevisionsParams = typeof planningRevisionsParamsSchema.Type;

/** The version history's read of a page, as the window hears it: the page as the service answered it, or that it did not answer. */
export const planningRevisionsAnswerSchema = EffectSchema.Union([
  planRevisionsAnswerSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(PLAN_CALL_FAILURE.UNANSWERED) }),
]);

export type PlanningRevisionsAnswer = typeof planningRevisionsAnswerSchema.Type;

/** One revision of a plan, as the version history names it to read it or to restore it: the plan and the revision's number. */
export const planningRevisionParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  seq: planRevisionSeqSchema,
});

export type PlanningRevisionParams = typeof planningRevisionParamsSchema.Type;

/** The version history's read of one revision, as the window hears it: the revision beside the one before it, or that the service did not answer. */
export const planningRevisionAnswerSchema = EffectSchema.Union([
  planRevisionAnswerSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(PLAN_CALL_FAILURE.UNANSWERED) }),
]);

export type PlanningRevisionAnswer = typeof planningRevisionAnswerSchema.Type;

/** One version of one page of a plan, as the frame drawing it names it. */
export const planningPageParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  pageId: EffectSchema.NonEmptyString,
  version: pageVersionNumberSchema,
});

export type PlanningPageParams = typeof planningPageParamsSchema.Type;

/** A page frame's read of one version, as the window's process hears it: the version with its HTML, or that the service did not answer. */
export const planningPageAnswerSchema = EffectSchema.Union([
  planPageVersionAnswerSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(PLAN_CALL_FAILURE.UNANSWERED) }),
]);

export type PlanningPageAnswer = typeof planningPageAnswerSchema.Type;
