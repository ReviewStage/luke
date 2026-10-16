import { Schema as EffectSchema } from "effect";
import { boardSaveRequestSchema, boardSchema } from "./board-wire.js";
import {
  CODING_AGENT_BOUNDS,
  codingAgentCallIdSchema,
  codingAgentMessagesAnswerSchema,
  planlessAgentSchema,
  storedObjectSchema,
  turnRecordFields,
} from "./coding-agent-wire.js";
import {
  githubPullRequestNumberSchema,
  githubPullRequestSummarySchema,
  githubRepositoriesAnswerSchema,
  githubRepositoryFullNameSchema,
  githubRepositoryPullRequestAnswerSchema,
} from "./github-repositories-wire.js";
import { linearIssueSummarySchema } from "./linear-wire.js";
import {
  pageLineSchema,
  pageVersionNumberSchema,
  planPageVersionAnswerSchema,
} from "./page-wire.js";
import { pictureDataUrlSchema, pictureTypeSchema } from "./picture-wire.js";
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
  workspaceIdSchema,
} from "./plan-wire.js";
import { planTranscriptSchema } from "./transcript-wire.js";
import { WORKSPACE_CALL_FAILURE } from "./workspace-call.js";
import {
  workspaceInvitationCancelSchema,
  workspaceInvitationSchema,
  workspaceInviteRequestSchema,
} from "./workspace-invitation-wire.js";
import {
  formerMemberSchema,
  linearIssuesRequestSchema,
  workspaceCreateRequestSchema,
  workspaceGithubRequestSchema,
  workspaceLeaveRequestSchema,
  workspaceMemberRemovalSchema,
  workspaceMemberRoleSchema,
  workspaceMemberSchema,
  workspacePhotoSetRequestSchema,
  workspacePhotoTypeSchema,
  workspaceRenameRequestSchema,
  workspaceSchema,
  workspaceTransferSchema,
} from "./workspace-wire.js";

/**
 * planning-view.ts -- the named plans as one Mac holds them for its panel's Plans tab: the list, the one active plan, and its saved document.
 *
 * The host reads the service for these and tells the desktop the whole view
 * whenever it moves; the desktop writes it into the document the planning
 * window draws from. Exactly one plan is ever active, the one the window has
 * open, and it is the plan a voice session binds to. The view carries plan
 * names, documents, and what was said on the active plan's calls from the
 * service, and nothing of this Mac's own: a plan's repository is the
 * service's, named on the plan itself. Beside the plans it carries the
 * workspaces the account is a member of, and the shapes the window asks a
 * workspace made, a GitHub organization connected or disconnected, a
 * members read, a removal, and a leave in.
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
 * How much of a turn one `plan.work` frame carries. The newest parts are
 * kept, and every string in them is cut to its bound, so a turn that read
 * a large file still travels in a frame of tens of kilobytes.
 */
export const PLAN_WORK_BOUNDS = {
  /** The most turns one read of a plan's work carries, the newest before where it began; older ones are read a page at a time. */
  TURNS: 20,
  PARTS: 60,
  TEXT_CHARS: 4_000,
  NAME_CHARS: 64,
  /** The most spoken lines one turn names as its ask. */
  ASKED_LINES: 20,
  /** The most characters of a spoken line's id, which the voice's ledger mints. */
  LINE_ID_CHARS: 128,
} as const;

const workText = EffectSchema.String.check(EffectSchema.isMaxLength(PLAN_WORK_BOUNDS.TEXT_CHARS));

/**
 * A journal as the agent tab reads one: its parts as the AI SDK stored them
 * (the model's words, its reasoning, and each tool call with its input and
 * answer, under the tool's own name), the newest kept and every string in
 * them cut to the text bound, so a turn that read a large file still travels
 * small. The desktop reads each call by its tool's name
 * (`@luke/features/agent-tools`), as it reads a coding agent's.
 */
const planWorkJournalSchema = EffectSchema.Array(storedObjectSchema).check(
  EffectSchema.isMaxLength(PLAN_WORK_BOUNDS.PARTS),
);

/**
 * One worker a turn handed work to, by the call that started it: the job it
 * was handed, the task eve runs it as, where it stands as its own session
 * reads (running while it works, though its call answered the moment it
 * started), and its session as a journal, with when its newest task began
 * and ended, its title, and what that task ran on and spent.
 */
const planWorkWorkerSchema = EffectSchema.Struct({
  callId: EffectSchema.String.check(EffectSchema.isMaxLength(PLAN_WORK_BOUNDS.LINE_ID_CHARS)),
  taskId: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(PLAN_WORK_BOUNDS.NAME_CHARS)),
  ),
  task: workText,
  state: EffectSchema.Literals(Object.values(PLAN_WORK_STATE)),
  earlierOmitted: EffectSchema.Boolean,
  journal: planWorkJournalSchema,
  startedAt: EffectSchema.optionalKey(EffectSchema.Finite),
  endedAt: EffectSchema.optionalKey(EffectSchema.Finite),
  title: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(CODING_AGENT_BOUNDS.MAX_TITLE_CHARS)),
  ),
  ...turnRecordFields,
});

export type PlanWorkWorker = typeof planWorkWorkerSchema.Type;

/**
 * One planning turn as the Work tab draws it: the turn, when it started and
 * ended, how far it has got, its journal and the workers it handed work to,
 * and what it ran on and spent. Unlike `plan.activity`, this carries each
 * call's output: the text a command answered in the plan's repository
 * sandbox, and pages read from the public web, shown back to the developer
 * on their own Mac.
 */
export const planWorkTurnSchema = EffectSchema.Struct({
  turnId: EffectSchema.String,
  /** Epoch milliseconds the turn started. */
  startedAt: EffectSchema.Finite,
  /** Epoch milliseconds the turn ended; absent while it runs, and from a service older than it. */
  endedAt: EffectSchema.optionalKey(EffectSchema.Finite),
  state: EffectSchema.Literals(Object.values(PLAN_WORK_STATE)),
  /** Whether older parts than the journal's were left out. */
  earlierOmitted: EffectSchema.Boolean,
  /** The turn's own journal, as the agent tab reads one. */
  journal: planWorkJournalSchema,
  /** The workers the turn handed work to, in the order it started them. */
  workers: EffectSchema.Array(planWorkWorkerSchema).check(
    EffectSchema.isMaxLength(PLAN_WORK_BOUNDS.PARTS),
  ),
  /**
   * The developer's spoken lines the turn took as its ask, by the ids the
   * Transcript names them by, in the order they were said: those of the asks
   * that opened it, never a follow-up the running turn was steered with;
   * absent for a turn no spoken line opened, before its lines are taken into
   * it, and from a service older than it.
   */
  asked: EffectSchema.optionalKey(
    EffectSchema.Array(
      EffectSchema.String.check(EffectSchema.isMaxLength(PLAN_WORK_BOUNDS.LINE_ID_CHARS)),
    ).check(EffectSchema.isMaxLength(PLAN_WORK_BOUNDS.ASKED_LINES)),
  ),
  /**
   * Where each of those lines began: the store's id for the call it was said
   * on, and the milliseconds into that call, as the Live API's transcript
   * deltas count them. A line heard on the call standing now carries the
   * voice window's own row id, which no turn names, and is matched by where
   * it began instead. Absent where `asked` is, for a line written before it
   * was recorded, and from a service older than it.
   */
  askedAt: EffectSchema.optionalKey(
    EffectSchema.Array(
      EffectSchema.Struct({
        voiceSessionId: EffectSchema.String.check(
          EffectSchema.isMaxLength(PLAN_WORK_BOUNDS.LINE_ID_CHARS),
        ),
        fromMs: EffectSchema.Finite,
      }),
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

/** Every code Luke showed on one plan, oldest first, as the Code tab draws it: the plan-work page's `code`, read on its own. */
export const planCodeAnswerSchema = EffectSchema.Struct({
  code: EffectSchema.Array(planShownCodeSchema),
});

export type PlanCodeAnswer = typeof planCodeAnswerSchema.Type;

/**
 * Whether the account has a GitHub account linked, and its login where the
 * service holds one: the view's copy of the connection the service answers.
 * Note that it is declared here rather than in `github-connection-wire.ts`,
 * which takes it from here, because the window reads this module and that
 * one's claim vocabulary has no business in the window's bundle.
 */
export const githubConnectionSchema = EffectSchema.Struct({
  connected: EffectSchema.Boolean,
  login: EffectSchema.NullOr(EffectSchema.String),
});

export const planningViewSchema = EffectSchema.Struct({
  /** The account's plans, newest started first, as the last list read answered. */
  plans: EffectSchema.Array(planSummarySchema),
  /** The agents with no plan in the account's workspaces, newest started first, as the last list read answered; absent before the first that carried them. */
  planlessAgents: EffectSchema.optionalKey(EffectSchema.Array(planlessAgentSchema)),
  listStatus: planningReadSchema,
  /** The workspaces the account is a member of, its first one first, as the last list read answered; none before the first lands. */
  workspaces: EffectSchema.Array(workspaceSchema),
  /** Whether the account has GitHub connected, and its login, as last read beside the workspaces; absent before the first read lands. */
  github: EffectSchema.optionalKey(githubConnectionSchema),
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
  /**
   * The active plan's planning conversation as an agent's transcript is
   * read: the newest page read when the plan opens, each page the held read
   * hears since joined by message id, and each older page read as the Call
   * tab scrolls back, before the rest. Its cursor is where the held read goes
   * on from, its `earlier` the turn the next older page is read before, and
   * its status and workers are the newest held page's. Absent before the
   * first read lands, and cleared with the activity; a reader that does not
   * know it draws `work` as before.
   */
  conversation: EffectSchema.optionalKey(codingAgentMessagesAnswerSchema),
  /**
   * The pages agents wrote for the active plan, each by its newest version,
   * the most recently written first, as last read with the plan; absent with
   * none, and cleared with the activity. Their HTML is never held here: the
   * frame that draws a page reads it alone (`planning.page`).
   */
  pages: EffectSchema.optionalKey(EffectSchema.Array(pageLineSchema)),
});

export type PlanningView = typeof planningViewSchema.Type;

/**
 * One page of a plan's planning conversation, as a window asks it: past a
 * cursor, before a turn, or the newest where it names neither; or, naming
 * the call that started one, a planning worker's transcript under the plan,
 * past a cursor, as an agent's worker tab reads it.
 */
export const planningMessagesParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  after: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
  before: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
  callId: EffectSchema.optionalKey(codingAgentCallIdSchema),
});

export type PlanningMessagesParams = typeof planningMessagesParamsSchema.Type;

/** The view before anything is asked: no plans read, none active. */
export const IDLE_PLANNING_VIEW: PlanningView = {
  plans: [],
  listStatus: PLANNING_READ.IDLE,
  workspaces: [],
  document: { status: PLANNING_READ.IDLE },
};

/** Starting a plan, as the window asks it: the name, and the repository it is about where one is chosen; the service keeps both. */
export const planningStartRequestSchema = planCreateRequestSchema;

export type PlanningStartRequest = typeof planningStartRequestSchema.Type;

/** The repository chip's read, as the window asks it: the workspace the listing is for, where one is chosen; every repository the account reaches otherwise. */
export const planningRepositoriesParamsSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.optionalKey(workspaceSchema.fields.id),
});

export type PlanningRepositoriesParams = typeof planningRepositoriesParamsSchema.Type;

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

/** Moving a plan to another of the account's workspaces: the plan, and the workspace it moves to. */
export const planningMoveParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  workspaceId: workspaceIdSchema,
});

export type PlanningMoveParams = typeof planningMoveParamsSchema.Type;

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
  /** The plan is archived, so it takes no write until it is brought back. */
  PLAN_ARCHIVED: "plan-archived",
  /** The workspace's Linear could not be read for the issue a plan was to start from: none connected, its grant refused, or no such issue. */
  LINEAR_UNAVAILABLE: "linear-unavailable",
} as const;

export type PlanCallFailure = (typeof PLAN_CALL_FAILURE)[keyof typeof PLAN_CALL_FAILURE];

/** Why a call that names a repository answered nothing: the service did not answer, or GitHub's reach refused it. */
const REPOSITORY_CALL_FAILURES = [
  PLAN_CALL_FAILURE.UNANSWERED,
  PLAN_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
] as const;

export type RepositoryCallFailure = (typeof REPOSITORY_CALL_FAILURES)[number];

const repositoryCallFailureSchema = EffectSchema.Literals(REPOSITORY_CALL_FAILURES);

/** Why a start answered no plan: a repository call's reasons, or the Linear issue it was to start from could not be read. */
const START_CALL_FAILURES = [
  ...REPOSITORY_CALL_FAILURES,
  PLAN_CALL_FAILURE.LINEAR_UNAVAILABLE,
] as const;

export type StartCallFailure = (typeof START_CALL_FAILURES)[number];

/** Starting a plan, as the window hears it: the plan now active, or why none started. */
export const planningStartAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ planId: EffectSchema.String }),
  EffectSchema.Struct({ failure: EffectSchema.Literals(START_CALL_FAILURES) }),
]);

export type PlanningStartAnswer = typeof planningStartAnswerSchema.Type;

/** Why the repository list answered nothing: the service did not answer. */
const REPOSITORY_LIST_FAILURES = [PLAN_CALL_FAILURE.UNANSWERED] as const;

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

/** A plan moved, as the window hears it: the workspace it now belongs to, or why it stands where it was. */
export const planningMoveAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ workspaceId: EffectSchema.String }),
  EffectSchema.Struct({ failure: EffectSchema.Literals(Object.values(PLAN_CALL_FAILURE)) }),
]);

export type PlanningMoveAnswer = typeof planningMoveAnswerSchema.Type;

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

/** A window of a file as the File tab draws it: its place, the branch it was read on and the commit where the service named it, how long the whole file is, and its lines as this Mac coloured them. */
const planFileShownSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  repository: EffectSchema.String,
  branch: EffectSchema.String,
  commit: EffectSchema.optionalKey(EffectSchema.String),
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

/**
 * A repository as a read with no plan names it, as an agent an automation
 * started names its own: the workspace whose installation reaches it, and
 * the repository.
 */
const repositoryPlaceFields = {
  workspaceId: workspaceIdSchema,
  repository: githubRepositoryFullNameSchema,
};

/**
 * One folder of a repository, as the File tab's tree or an `@` list asks
 * the host for it: the plan whose repository it is, or the workspace and
 * the repository where no plan names it, and the folder's path from the root.
 */
export const planningTreeParamsSchema = EffectSchema.Union([
  EffectSchema.Struct({ planId: EffectSchema.NonEmptyString, ...planTreeRequestSchema.fields }),
  EffectSchema.Struct({ ...repositoryPlaceFields, ...planTreeRequestSchema.fields }),
]);

export type PlanningTreeParams = typeof planningTreeParamsSchema.Type;

/** The tree's read of a folder, as the window hears it: the folder listed, why it is not, or that the service did not answer. */
export const planningTreeAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ folder: planTreeFolderSchema }),
  planFileRefusalSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(PLAN_CALL_FAILURE.UNANSWERED) }),
]);

export type PlanningTreeAnswer = typeof planningTreeAnswerSchema.Type;

/** The skills a developer may choose of a repository, as the window asks the host for them: the plan whose repository it is, or the workspace and the repository where no plan names it. */
export const planningSkillsParamsSchema = EffectSchema.Union([
  EffectSchema.Struct({ planId: EffectSchema.NonEmptyString }),
  EffectSchema.Struct(repositoryPlaceFields),
]);

export type PlanningSkillsParams = typeof planningSkillsParamsSchema.Type;

/** The read of a repository's skills, as the window hears it: the skills, why they are not read, or that the service did not answer. */
export const planningSkillsAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ skills: planSkillsSchema }),
  planFileRefusalSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(PLAN_CALL_FAILURE.UNANSWERED) }),
]);

export type PlanningSkillsAnswer = typeof planningSkillsAnswerSchema.Type;

/** One pull request of a repository, as a link to it asks the host for it: the workspace whose installation reaches the repository, the repository, and the pull request's number. */
export const planningPullRequestParamsSchema = EffectSchema.Struct({
  ...repositoryPlaceFields,
  number: githubPullRequestNumberSchema,
});

export type PlanningPullRequestParams = typeof planningPullRequestParamsSchema.Type;

/** The read of one pull request, as the window hears it: the pull request, null where there is none to draw, or that the service did not answer. */
export const planningPullRequestAnswerSchema = EffectSchema.Union([
  githubRepositoryPullRequestAnswerSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(PLAN_CALL_FAILURE.UNANSWERED) }),
]);

export type PlanningPullRequestAnswer = typeof planningPullRequestAnswerSchema.Type;

/** The pull request as a link that asked draws it, once the service answered: its number, title, page, and state, or null where there is none to draw. */
export const planningPullRequestSchema = EffectSchema.NullOr(githubPullRequestSummarySchema);

export type PlanningPullRequest = typeof planningPullRequestSchema.Type;

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

/** One picture of a plan, as the window drawing it names it: the plan, and the picture's id its text names. */
export const planningPictureParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  attachmentId: EffectSchema.NonEmptyString,
});

export type PlanningPictureParams = typeof planningPictureParamsSchema.Type;

/**
 * One picture of a plan, as the window hears it: its bytes in base64 under
 * its media type, which the window draws from a `data:` URL of its own
 * making, or why there is none: not the account's to read, or no answer.
 * The host fetched it under the account, so the window holds no bearer and
 * no address.
 */
export const planningPictureAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ contentType: pictureTypeSchema, base64: EffectSchema.String }),
  EffectSchema.Struct({
    failure: EffectSchema.Literals([PLAN_CALL_FAILURE.NOT_FOUND, PLAN_CALL_FAILURE.UNANSWERED]),
  }),
]);

export type PlanningPictureAnswer = typeof planningPictureAnswerSchema.Type;

/** A picture kept on a plan, as the editor that took it asks: the plan, and the picture as a `data:` URL. */
export const planningPictureKeepParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  picture: pictureDataUrlSchema,
});

export type PlanningPictureKeepParams = typeof planningPictureKeepParamsSchema.Type;

/** Why a picture was not kept: the plan holds its bound of pictures, the plan is not the account's to write, or no answer. */
export const PICTURE_KEEP_FAILURE = {
  TOO_MANY: "too-many",
  NOT_FOUND: PLAN_CALL_FAILURE.NOT_FOUND,
  UNANSWERED: PLAN_CALL_FAILURE.UNANSWERED,
} as const;

/** A picture kept, as the editor hears it: the id its text names it by, or why it was not kept. */
export const planningPictureKeepAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ id: EffectSchema.NonEmptyString }),
  EffectSchema.Struct({ failure: EffectSchema.Literals(Object.values(PICTURE_KEEP_FAILURE)) }),
]);

export type PlanningPictureKeepAnswer = typeof planningPictureKeepAnswerSchema.Type;

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

/** A page tab's read of one version's source, as the window hears it: its HTML line by line, coloured as HTML, or that the service did not answer. */
export const planningPageSourceAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ lines: codeLinesSchema }),
  EffectSchema.Struct({ failure: EffectSchema.Literal(PLAN_CALL_FAILURE.UNANSWERED) }),
]);

export type PlanningPageSourceAnswer = typeof planningPageSourceAnswerSchema.Type;

const workspaceCallFailureSchema = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(WORKSPACE_CALL_FAILURE)),
});

/** Making a workspace, as the window asks it: its name, as the service takes it; the account that asks owns it. */
export const planningWorkspaceCreateParamsSchema = workspaceCreateRequestSchema;

export type PlanningWorkspaceCreateParams = typeof planningWorkspaceCreateParamsSchema.Type;

/** Renaming a workspace, as the window asks it: the workspace and its new name, as the service takes them. */
export const planningWorkspaceRenameParamsSchema = workspaceRenameRequestSchema;

export type PlanningWorkspaceRenameParams = typeof planningWorkspaceRenameParamsSchema.Type;

/** Setting or removing a workspace's photo, as the window asks it: the workspace and the photo as a `data:` URL, or null, as the service takes them. */
export const planningWorkspacePhotoSetParamsSchema = workspacePhotoSetRequestSchema;

export type PlanningWorkspacePhotoSetParams = typeof planningWorkspacePhotoSetParamsSchema.Type;

/** One workspace, as the window names it to read its invitations, or to connect or disconnect its GitHub organization. */
export const planningWorkspaceParamsSchema = workspaceGithubRequestSchema;

export type PlanningWorkspaceParams = typeof planningWorkspaceParamsSchema.Type;

/** A workspace made, renamed, or given a photo, or its GitHub organization disconnected, as the window hears it: the workspace as it then stands, or why it does not. */
export const planningWorkspaceAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ workspace: workspaceSchema }),
  workspaceCallFailureSchema,
]);

export type PlanningWorkspaceAnswer = typeof planningWorkspaceAnswerSchema.Type;

/** A GitHub organization's connection begun, as the window's process hears it: the Luke GitHub App's install address to open, or why there is none. */
export const planningWorkspaceGitHubConnectAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ url: EffectSchema.String }),
  workspaceCallFailureSchema,
]);

export type PlanningWorkspaceGitHubConnectAnswer =
  typeof planningWorkspaceGitHubConnectAnswerSchema.Type;

/** The Linear issues a window asks for, to start a plan from one: the workspace, and a search where one is typed. */
export const planningLinearIssuesParamsSchema = linearIssuesRequestSchema;

export type PlanningLinearIssuesParams = typeof planningLinearIssuesParamsSchema.Type;

/** The Linear issues as the window hears them: the issues the workspace's connection reaches, or why there are none. */
export const planningLinearIssuesAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ issues: EffectSchema.Array(linearIssueSummarySchema) }),
  workspaceCallFailureSchema,
]);

export type PlanningLinearIssuesAnswer = typeof planningLinearIssuesAnswerSchema.Type;

/** A workspace's members, as the window asks for them: the workspace. */
export const planningWorkspaceMembersParamsSchema = workspaceLeaveRequestSchema;

export type PlanningWorkspaceMembersParams = typeof planningWorkspaceMembersParamsSchema.Type;

/** Removing one member of a workspace, as the window asks it: the workspace and the member's account. */
export const planningWorkspaceMemberRemoveParamsSchema = workspaceMemberRemovalSchema;

export type PlanningWorkspaceMemberRemoveParams =
  typeof planningWorkspaceMemberRemoveParamsSchema.Type;

/** Giving another member of a workspace a role, as the window asks it: the workspace, the member's account, and admin or member. */
export const planningWorkspaceMemberRoleParamsSchema = workspaceMemberRoleSchema;

export type PlanningWorkspaceMemberRoleParams = typeof planningWorkspaceMemberRoleParamsSchema.Type;

/** Handing a workspace to one of its admins, as the window asks it: the workspace and the admin's account. */
export const planningWorkspaceTransferParamsSchema = workspaceTransferSchema;

export type PlanningWorkspaceTransferParams = typeof planningWorkspaceTransferParamsSchema.Type;

/** A workspace's members, as the window hears them after a read, a removal, a role changed, or a handover: the members as they then stand, or why there are none. */
export const planningWorkspaceMembersAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    members: EffectSchema.Array(workspaceMemberSchema),
    /** Who the workspace's work names but left, on a read; absent after a change, and from a service before it. */
    former: EffectSchema.optionalKey(EffectSchema.Array(formerMemberSchema)),
  }),
  workspaceCallFailureSchema,
]);

export type PlanningWorkspaceMembersAnswer = typeof planningWorkspaceMembersAnswerSchema.Type;

/** A workspace's photo, as a window's tile asks for it: the workspace. */
export const planningWorkspacePhotoParamsSchema = workspaceLeaveRequestSchema;

export type PlanningWorkspacePhotoParams = typeof planningWorkspacePhotoParamsSchema.Type;

/**
 * A workspace's photo, as the window hears it: its bytes in base64 under
 * its media type, which the window draws from a `data:` URL of its own
 * making, or why there is none: not a member, no photo, or no answer. The
 * host fetched it under the account, so the window holds no bearer and no
 * address.
 */
export const planningWorkspacePhotoAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ contentType: workspacePhotoTypeSchema, base64: EffectSchema.String }),
  workspaceCallFailureSchema,
]);

export type PlanningWorkspacePhotoAnswer = typeof planningWorkspacePhotoAnswerSchema.Type;

/** Leaving a workspace, as the window asks it: the workspace. */
export const planningWorkspaceLeaveParamsSchema = workspaceLeaveRequestSchema;

export type PlanningWorkspaceLeaveParams = typeof planningWorkspaceLeaveParamsSchema.Type;

/** A leave, as the window hears it: left, the view's list then without it, or why not. */
export const planningWorkspaceLeaveAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ left: EffectSchema.Literal(true) }),
  workspaceCallFailureSchema,
]);

export type PlanningWorkspaceLeaveAnswer = typeof planningWorkspaceLeaveAnswerSchema.Type;

/** An invitation, as the window asks for it: the workspace, the address, and the role. */
export const planningWorkspaceInviteParamsSchema = workspaceInviteRequestSchema;

export type PlanningWorkspaceInviteParams = typeof planningWorkspaceInviteParamsSchema.Type;

/** An invitation made, as the window hears it: the invitation with its accept link, or why none was. */
export const planningWorkspaceInvitationAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ invitation: workspaceInvitationSchema }),
  workspaceCallFailureSchema,
]);

export type PlanningWorkspaceInvitationAnswer = typeof planningWorkspaceInvitationAnswerSchema.Type;

/** A pending invitation canceled, as the window asks it: the workspace and the invitation. */
export const planningWorkspaceInvitationCancelParamsSchema = workspaceInvitationCancelSchema;

export type PlanningWorkspaceInvitationCancelParams =
  typeof planningWorkspaceInvitationCancelParamsSchema.Type;

/** A workspace's pending invitations, as the window hears them after a read or a cancel, or why there are none. */
export const planningWorkspaceInvitationsAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ invitations: EffectSchema.Array(workspaceInvitationSchema) }),
  workspaceCallFailureSchema,
]);

export type PlanningWorkspaceInvitationsAnswer =
  typeof planningWorkspaceInvitationsAnswerSchema.Type;

/** A page about the account's GitHub connection, as the window hears it: the address to open in the browser, or that the service did not answer. */
export const planningGitHubPageAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ url: EffectSchema.String }),
  EffectSchema.Struct({ failure: EffectSchema.Literal(PLAN_CALL_FAILURE.UNANSWERED) }),
]);

export type PlanningGitHubPageAnswer = typeof planningGitHubPageAnswerSchema.Type;

/** Why the account's GitHub was not disconnected: no answer, or GitHub is its only way to sign in. */
export const GITHUB_DISCONNECT_FAILURE = {
  UNANSWERED: PLAN_CALL_FAILURE.UNANSWERED,
  NOT_PERMITTED: "not-permitted",
} as const;

/** A disconnect of the account's GitHub, as the window's process hears it: the connection as it then stands, or why it is not. */
export const planningGitHubDisconnectAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ connection: githubConnectionSchema }),
  EffectSchema.Struct({
    failure: EffectSchema.Literals(Object.values(GITHUB_DISCONNECT_FAILURE)),
  }),
]);

export type PlanningGitHubDisconnectAnswer = typeof planningGitHubDisconnectAnswerSchema.Type;
