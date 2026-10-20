import { Schema as EffectSchema } from "effect";
import { boardSaveRequestSchema, boardSchema } from "./board-wire.js";
import { codingAgentAgentAnswerSchema } from "./coding-agent-view.js";
import {
  CODING_AGENT_BOUNDS,
  codingAgentCallIdSchema,
  codingAgentMessagesAnswerSchema,
  storedObjectSchema,
  tasklessAgentSchema,
  turnRecordFields,
} from "./coding-agent-wire.js";
import {
  githubIssueSummarySchema,
  githubPullRequestNumberSchema,
  githubPullRequestSummarySchema,
  githubRepositoriesAnswerSchema,
  githubRepositoryFullNameSchema,
  githubRepositoryIssueAnswerSchema,
  githubRepositoryPullRequestAnswerSchema,
} from "./github-repositories-wire.js";
import { linearIssueSummarySchema } from "./linear-wire.js";
import {
  pageLineSchema,
  pageVersionNumberSchema,
  planPageVersionAnswerSchema,
  taskPagesAnswerSchema,
} from "./page-wire.js";
import { pictureDataUrlSchema, pictureTypeSchema } from "./picture-wire.js";
import { pinPositionSchema } from "./pin-order.js";
import {
  planCommentActionRequestSchema,
  planCommentStartRequestSchema,
  planCommentsAnswerSchema,
  planCommentThreadAnswerSchema,
} from "./plan-comment-wire.js";
import { PLAN_EDIT_REFUSAL, planEditRequestSchema, planEditValueSchema } from "./plan-edit.js";
import { taskSectionsAnswerSchema, taskSectionWriteSchema } from "./task-section-wire.js";
import {
  codeRefSchema,
  planRevisionAnswerSchema,
  planRevisionSeqSchema,
  planRevisionsAnswerSchema,
  repositoryPinRequestSchema,
  repositoryPinSchema,
  shownCodeSchema,
  taskCreateRequestSchema,
  taskFileRefusalSchema,
  taskFileRequestSchema,
  taskFileTextSchema,
  taskPrioritySchema,
  taskRenameRequestSchema,
  taskSchema,
  taskSkillsSchema,
  taskStatusSchema,
  taskSummarySchema,
  taskTreeFolderSchema,
  taskTreeRequestSchema,
  workspaceIdSchema,
} from "./task-wire.js";
import { taskTranscriptSchema } from "./transcript-wire.js";
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
 * tasks-view.ts -- the named tasks as one Mac holds them for its panel's Tasks tab: the list, the one active task, and its saved document.
 *
 * The host reads the service for these and tells the desktop the whole view
 * whenever it moves; the desktop writes it into the document the tasks
 * window draws from. Exactly one task is ever active, the one the window has
 * open, and it is the task a voice session binds to. The view carries task
 * names, documents, and what was said on the active task's calls from the
 * service, and nothing of this Mac's own: a task's repository is the
 * service's, named on the task itself. Beside the tasks it carries the
 * workspaces the account is a member of, and the shapes the window asks a
 * workspace made, a GitHub organization connected or disconnected, a
 * members read, a removal, and a leave in.
 */

/** Where one read of the service stands, as the window draws it. */
export const TASKS_READ = {
  /** Nothing has been asked yet. */
  IDLE: "idle",
  /** Asked, and not yet answered. */
  READING: "reading",
  /** The last read landed; what it read is drawn. */
  READY: "ready",
  /** The last read did not land; the window offers to try again. */
  FAILED: "failed",
  /** The active task is not one the account holds any more. */
  MISSING: "missing",
} as const;

const tasksReadSchema = EffectSchema.Literals(Object.values(TASKS_READ));

/**
 * The active task's document as last read: the plan whole while a read has
 * landed, kept through a later read that failed, so the window never draws a
 * document it did not read and never drops one it did.
 */
const tasksDocumentSchema = EffectSchema.Struct({
  status: tasksReadSchema,
  task: EffectSchema.optionalKey(taskSchema),
});

export type TasksDocument = typeof tasksDocumentSchema.Type;

/**
 * What was said on the active task's calls as last read, kept through a
 * later read that failed, as the document is. The call standing now is not
 * in it until the call ends and the transcript is read again: its words so
 * far are the voice window's to report.
 */
const tasksTranscriptSchema = EffectSchema.Struct({
  status: tasksReadSchema,
  transcript: EffectSchema.optionalKey(taskTranscriptSchema),
});

/**
 * The two waits on the voice side that no live status names: the voice model
 * delegated an ask the brain has not yet taken, or words are queued
 * for Luke that his voice has not begun to say.
 */
export const VOICE_PHASE = {
  HANDING_OFF: "handing_off",
  ABOUT_TO_ANSWER: "about_to_answer",
} as const;

export type VoicePhase = (typeof VOICE_PHASE)[keyof typeof VOICE_PHASE];

/** The most of the brain's pending command an activity carries; the service cuts it there. */
export const TASK_ACTIVITY_ACTION_MAX_CHARS = 120;

/**
 * What each part of Luke is doing on a task call, whole, as the service's
 * `task.activity` frame says it: the voice's wait where it is in one, the
 * brain while it works on an ask with the command it is running
 * where one is pending, and whether the notetaker is writing. Nothing of the
 * ask, and no tool's output.
 */
export const taskActivitySchema = EffectSchema.Struct({
  voice: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(VOICE_PHASE))),
  // Note that the key keeps the wire's legacy spelling, renamed with the wire in the follow-up.
  planner: EffectSchema.optionalKey(
    EffectSchema.Struct({
      action: EffectSchema.optionalKey(
        EffectSchema.String.check(EffectSchema.isMaxLength(TASK_ACTIVITY_ACTION_MAX_CHARS)),
      ),
    }),
  ),
  notes: EffectSchema.Boolean,
});

export type TaskActivity = typeof taskActivitySchema.Type;

/** How far a brain turn, or one call inside it, has got. */
export const TASK_WORK_STATE = {
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
} as const;

export type TaskWorkState = (typeof TASK_WORK_STATE)[keyof typeof TASK_WORK_STATE];

/**
 * How much of a turn one `task.work` frame carries. The newest parts are
 * kept, and every string in them is cut to its bound, so a turn that read
 * a large file still travels in a frame of tens of kilobytes.
 */
export const TASK_WORK_BOUNDS = {
  /** The most turns one read of a task's work carries, the newest before where it began; older ones are read a page at a time. */
  TURNS: 20,
  PARTS: 60,
  TEXT_CHARS: 4_000,
  NAME_CHARS: 64,
  /** The most spoken lines one turn names as its ask. */
  ASKED_LINES: 20,
  /** The most characters of a spoken line's id, which the voice's ledger mints. */
  LINE_ID_CHARS: 128,
} as const;

const workText = EffectSchema.String.check(EffectSchema.isMaxLength(TASK_WORK_BOUNDS.TEXT_CHARS));

/**
 * A journal as the agent tab reads one: its parts as the AI SDK stored them
 * (the model's words, its reasoning, and each tool call with its input and
 * answer, under the tool's own name), the newest kept and every string in
 * them cut to the text bound, so a turn that read a large file still travels
 * small. The desktop reads each call by its tool's name
 * (`@luke/features/agent-tools`), as it reads a coding agent's.
 */
const taskWorkJournalSchema = EffectSchema.Array(storedObjectSchema).check(
  EffectSchema.isMaxLength(TASK_WORK_BOUNDS.PARTS),
);

/**
 * One worker a turn handed work to, by the call that started it: the job it
 * was handed, the task eve runs it as, where it stands as its own session
 * reads (running while it works, though its call answered the moment it
 * started), and its session as a journal, with when its newest task began
 * and ended, its title, and what that task ran on and spent.
 */
const taskWorkWorkerSchema = EffectSchema.Struct({
  callId: EffectSchema.String.check(EffectSchema.isMaxLength(TASK_WORK_BOUNDS.LINE_ID_CHARS)),
  taskId: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(TASK_WORK_BOUNDS.NAME_CHARS)),
  ),
  task: workText,
  state: EffectSchema.Literals(Object.values(TASK_WORK_STATE)),
  earlierOmitted: EffectSchema.Boolean,
  journal: taskWorkJournalSchema,
  startedAt: EffectSchema.optionalKey(EffectSchema.Finite),
  endedAt: EffectSchema.optionalKey(EffectSchema.Finite),
  title: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(CODING_AGENT_BOUNDS.MAX_TITLE_CHARS)),
  ),
  ...turnRecordFields,
});

export type TaskWorkWorker = typeof taskWorkWorkerSchema.Type;

/**
 * One brain turn as the Work tab draws it: the turn, when it started and
 * ended, how far it has got, its journal and the workers it handed work to,
 * and what it ran on and spent. Unlike `task.activity`, this carries each
 * call's output: the text a command answered in the task's repository
 * sandbox, and pages read from the public web, shown back to the developer
 * on their own Mac.
 */
export const taskWorkTurnSchema = EffectSchema.Struct({
  turnId: EffectSchema.String,
  /** Epoch milliseconds the turn started. */
  startedAt: EffectSchema.Finite,
  /** Epoch milliseconds the turn ended; absent while it runs, and from a service older than it. */
  endedAt: EffectSchema.optionalKey(EffectSchema.Finite),
  state: EffectSchema.Literals(Object.values(TASK_WORK_STATE)),
  /** Whether older parts than the journal's were left out. */
  earlierOmitted: EffectSchema.Boolean,
  /** The turn's own journal, as the agent tab reads one. */
  journal: taskWorkJournalSchema,
  /** The workers the turn handed work to, in the order it started them. */
  workers: EffectSchema.Array(taskWorkWorkerSchema).check(
    EffectSchema.isMaxLength(TASK_WORK_BOUNDS.PARTS),
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
      EffectSchema.String.check(EffectSchema.isMaxLength(TASK_WORK_BOUNDS.LINE_ID_CHARS)),
    ).check(EffectSchema.isMaxLength(TASK_WORK_BOUNDS.ASKED_LINES)),
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
          EffectSchema.isMaxLength(TASK_WORK_BOUNDS.LINE_ID_CHARS),
        ),
        fromMs: EffectSchema.Finite,
      }),
    ).check(EffectSchema.isMaxLength(TASK_WORK_BOUNDS.ASKED_LINES)),
  ),
  ...turnRecordFields,
});

export type TaskWorkTurn = typeof taskWorkTurnSchema.Type;

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
 * One code Luke showed on the active task: what he named, the repository
 * the service read it from, the file's lines as they arrived and this
 * Mac coloured them, the window's first line first, and his note on them. Nothing of it enters
 * the task's document.
 */
const taskCodeSchema = EffectSchema.Struct({
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

export type TaskCode = typeof taskCodeSchema.Type;

/**
 * One code Luke showed on a task: the `show_code` call that showed it, the
 * turn it ran in and when that turn began writing, and the place and lines
 * as the call answered them.
 */
const taskShownCodeFields = {
  callId: EffectSchema.String,
  turnId: EffectSchema.String,
  /** Epoch milliseconds the turn that showed it began. */
  shownAt: EffectSchema.Finite,
};

export const taskShownCodeSchema = EffectSchema.Struct({
  ...taskShownCodeFields,
  code: shownCodeSchema,
});

export type TaskShownCode = typeof taskShownCodeSchema.Type;

/**
 * One code shown on the active task as the Code tab draws it: the call that
 * showed it, its turn and when that began, and the lines coloured.
 */
const taskCodeShowingSchema = EffectSchema.Struct({
  ...taskShownCodeFields,
  code: taskCodeSchema,
});

export type TaskCodeShowing = typeof taskCodeShowingSchema.Type;

/**
 * A task's work as the service keeps it (GET `/api/plans/{id}/work`, with
 * `before` naming a turn for an older page): a page of the brain turns of
 * its calls, the newest before where the read began, oldest first, each as
 * a `task.work` frame would tell it, and the turn to read before for the
 * page older than this one. The newest page also carries every code Luke
 * showed on the task, oldest first, with the lines each `show_code` call
 * answered, several of one file included. It is what the Work and Code tabs
 * draw when a task opens, after a restart or a switch from another task,
 * before any call about it tells more.
 */
export const taskWorkAnswerSchema = EffectSchema.Struct({
  turns: EffectSchema.Array(taskWorkTurnSchema),
  /** The turn the next older page is read before; absent where no older turn stands. */
  earlier: EffectSchema.optionalKey(EffectSchema.String),
  /** Every code shown on the task, oldest first; carried on the newest page alone. */
  code: EffectSchema.optionalKey(EffectSchema.Array(taskShownCodeSchema)),
});

export type TaskWorkAnswer = typeof taskWorkAnswerSchema.Type;

/** Every code Luke showed on one task, oldest first, as the Code tab draws it: the plan-work page's `code`, read on its own. */
export const taskCodeAnswerSchema = EffectSchema.Struct({
  code: EffectSchema.Array(taskShownCodeSchema),
});

export type TaskCodeAnswer = typeof taskCodeAnswerSchema.Type;

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

export const tasksViewSchema = EffectSchema.Struct({
  /** The account's tasks, newest started first, as the last list read answered. */
  tasks: EffectSchema.Array(taskSummarySchema),
  /** The agents with no plan in the account's workspaces, newest started first, as the last list read answered; absent before the first that carried them. */
  tasklessAgents: EffectSchema.optionalKey(EffectSchema.Array(tasklessAgentSchema)),
  listStatus: tasksReadSchema,
  /** The workspaces the account is a member of, its first one first, as the last list read answered; none before the first lands. */
  workspaces: EffectSchema.Array(workspaceSchema),
  /** Where the read of the workspaces stands, a failed one keeping those held; absent before the first is asked. */
  workspacesStatus: EffectSchema.optionalKey(tasksReadSchema),
  /** Whether the account has GitHub connected, and its login, as last read beside the workspaces; absent before the first read lands. */
  github: EffectSchema.optionalKey(githubConnectionSchema),
  /** The repositories the account pinned in the sidebar, newest pinned first, as last read or pinned; absent before the first read lands. */
  repositoryPins: EffectSchema.optionalKey(EffectSchema.Array(repositoryPinSchema)),
  /** The sections the account made in its sidebars and the tasks it keeps in them, as last read or written; absent before the first read lands. */
  taskSections: EffectSchema.optionalKey(taskSectionsAnswerSchema),
  /** The one active task, absent while the window has none open. */
  activeTaskId: EffectSchema.optionalKey(EffectSchema.String),
  document: tasksDocumentSchema,
  /** What each part of Luke is doing on the call about the active task, as last told; absent with no task open or no word yet. */
  activity: EffectSchema.optionalKey(taskActivitySchema),
  /**
   * What each part of Luke is doing on the standing call, whichever task it
   * is about, as last told: what the floating call window draws while the
   * call's task is not the one open. Absent before the first word and once
   * the call has ended.
   */
  callActivity: EffectSchema.optionalKey(taskActivitySchema),
  /** The active task's whiteboard as last read or saved; absent with no task open or before its first read lands. */
  board: EffectSchema.optionalKey(boardSchema),
  /** What was said on the active task's calls as last read; absent with no task open. */
  transcript: EffectSchema.optionalKey(tasksTranscriptSchema),
  /**
   * Every code Luke showed on the active task, oldest first, several of one
   * file included: what the task's work holds, read with the newest page,
   * and each code a call shows since, by its call, so a call's code and
   * the record's copy of it stand once; absent with none, and cleared with
   * the activity. A call's end keeps them.
   */
  shownCode: EffectSchema.optionalKey(EffectSchema.Array(taskCodeShowingSchema)),
  /**
   * The brain turns of the active task's calls, oldest first: the newest
   * page read from the service when the task opens, each older page read as
   * the Work tab scrolls back, and each turn a call tells since as last
   * told; absent before the first, and cleared with the activity. A call's
   * end keeps them.
   */
  work: EffectSchema.optionalKey(EffectSchema.Array(taskWorkTurnSchema)),
  /** The turn the active task's next older page of work is read before; absent where none stands or before the first read. */
  workEarlier: EffectSchema.optionalKey(EffectSchema.String),
  /** Where the read of the active task's newest work and code stands, a failed one keeping what is held; absent before the first is asked, and cleared with the activity. */
  workStatus: EffectSchema.optionalKey(tasksReadSchema),
  /**
   * The active task's conversation as an agent's transcript is
   * read: the newest page read when the task opens, each page the held read
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
   * the most recently written first, as last read with the task; absent with
   * none, and cleared with the activity. Their HTML is never held here: the
   * frame that draws a page reads it alone (`brain.page`).
   */
  pages: EffectSchema.optionalKey(EffectSchema.Array(pageLineSchema)),
});

export type TasksView = typeof tasksViewSchema.Type;

/**
 * One page of a task's conversation, as a window asks it: past a
 * cursor, before a turn, or the newest where it names neither; or, naming
 * the call that started one, a brain worker's transcript under the task,
 * past a cursor, as an agent's worker tab reads it.
 */
export const tasksMessagesParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  after: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
  before: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
  callId: EffectSchema.optionalKey(codingAgentCallIdSchema),
});

export type TasksMessagesParams = typeof tasksMessagesParamsSchema.Type;

/** The view before anything is asked: no tasks read, none active. */
export const IDLE_TASKS_VIEW: TasksView = {
  tasks: [],
  listStatus: TASKS_READ.IDLE,
  workspaces: [],
  document: { status: TASKS_READ.IDLE },
};

/** Starting a task, as the window asks it: the name, and the repository it is about where one is chosen; the service keeps both. */
export const tasksStartRequestSchema = taskCreateRequestSchema;

export type TasksStartRequest = typeof tasksStartRequestSchema.Type;

/** The repository chip's read, as the window asks it: the workspace the listing is for, where one is chosen; every repository the account reaches otherwise. */
export const tasksRepositoriesParamsSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.optionalKey(workspaceSchema.fields.id),
});

export type TasksRepositoriesParams = typeof tasksRepositoriesParamsSchema.Type;

/** Renaming a task, as the window asks it: the task, and the name the service keeps. */
export const tasksRenameParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  ...taskRenameRequestSchema.fields,
});

export type TasksRenameParams = typeof tasksRenameParamsSchema.Type;

/** Pinning a task, or unpinning it, as the window asks it. */
export const tasksPinParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  pinned: EffectSchema.Boolean,
  /** Where the pin stands in the sidebar's Pinned section, given as it is dragged there; only with a pin. */
  position: EffectSchema.optionalKey(pinPositionSchema),
});

export type TasksPinParams = typeof tasksPinParamsSchema.Type;

/** Pinning a repository in the sidebar, or unpinning it, as the window asks it; the service keeps it on the account. */
export const tasksPinRepositoryParamsSchema = repositoryPinRequestSchema;

export type TasksPinRepositoryParams = typeof tasksPinRepositoryParamsSchema.Type;

/** One change to the account's sidebar sections, as the window asks it; the service keeps them on the account. */
export const tasksWriteSectionParamsSchema = taskSectionWriteSchema;

export type TasksWriteSectionParams = typeof tasksWriteSectionParamsSchema.Type;

/** Archiving a task, or bringing it back, as the window asks it. */
export const tasksArchiveParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  archived: EffectSchema.Boolean,
});

export type TasksArchiveParams = typeof tasksArchiveParamsSchema.Type;

/** Giving a task its repository, or taking it away: the task, and the repository's full name or null for none. */
export const tasksSetRepositoryParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  repository: EffectSchema.NullOr(githubRepositoryFullNameSchema),
});

export type TasksSetRepositoryParams = typeof tasksSetRepositoryParamsSchema.Type;

/** Whether a change of where a task stands names its status, its priority, or both. */
function namesAStanding(params: { status?: unknown; priority?: unknown }): boolean {
  return params.status !== undefined || params.priority !== undefined;
}

/** Setting where a task stands, how much it matters, or both, as the window asks it. */
export const tasksSetStandingParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  status: EffectSchema.optionalKey(taskStatusSchema),
  priority: EffectSchema.optionalKey(taskPrioritySchema),
}).check(EffectSchema.makeFilter(namesAStanding));

export type TasksSetStandingParams = typeof tasksSetStandingParamsSchema.Type;

/** Moving a task to another of the account's workspaces: the task, and the workspace it moves to. */
export const tasksMoveParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  workspaceId: workspaceIdSchema,
});

export type TasksMoveParams = typeof tasksMoveParamsSchema.Type;

/** A task's board as the panel asks it saved: the whole scene, and the number of Luke's drawing it holds. */
export const tasksBoardSaveParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  ...boardSaveRequestSchema.fields,
});

export type TasksBoardSaveParams = typeof tasksBoardSaveParamsSchema.Type;

/** Why a task call answered nothing a window can draw. */
export const TASK_CALL_FAILURE = {
  /** The call never reached an answer: no credential, the network, a refusal, a shape not read. */
  UNANSWERED: "unanswered",
  /** The task is not one the account holds: deleted, or never the caller's. */
  NOT_FOUND: "not-found",
  /** The repository named is not one the Luke GitHub App reaches for the account. */
  REPOSITORY_NOT_REACHABLE: "repository-not-reachable",
  /** The task is archived, so it takes no write until it is brought back. */
  TASK_ARCHIVED: "plan-archived",
  /** The workspace's Linear could not be read for the issue a plan was to start from: none connected, its grant refused, or no such issue. */
  LINEAR_UNAVAILABLE: "linear-unavailable",
} as const;

export type TaskCallFailure = (typeof TASK_CALL_FAILURE)[keyof typeof TASK_CALL_FAILURE];

/** Why a call that names a repository answered nothing: the service did not answer, or GitHub's reach refused it. */
const REPOSITORY_CALL_FAILURES = [
  TASK_CALL_FAILURE.UNANSWERED,
  TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
] as const;

export type RepositoryCallFailure = (typeof REPOSITORY_CALL_FAILURES)[number];

const repositoryCallFailureSchema = EffectSchema.Literals(REPOSITORY_CALL_FAILURES);

/** Why a start answered no plan: a repository call's reasons, the Linear issue it was to start from could not be read, or the workspace's own issue it was to start from is none of the workspace's. */
const START_CALL_FAILURES = [
  ...REPOSITORY_CALL_FAILURES,
  TASK_CALL_FAILURE.LINEAR_UNAVAILABLE,
  TASK_CALL_FAILURE.NOT_FOUND,
] as const;

export type StartCallFailure = (typeof START_CALL_FAILURES)[number];

/**
 * Starting a task, as the window hears it: the task now active, with the
 * agent started on it, or why it was not, where the start named one, as an
 * agent's Start answers; or why no task started.
 */
export const tasksStartAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    planId: EffectSchema.String,
    agentStart: EffectSchema.optionalKey(codingAgentAgentAnswerSchema),
  }),
  EffectSchema.Struct({ failure: EffectSchema.Literals(START_CALL_FAILURES) }),
]);

export type TasksStartAnswer = typeof tasksStartAnswerSchema.Type;

/** Why the repository list answered nothing: the service did not answer. */
const REPOSITORY_LIST_FAILURES = [TASK_CALL_FAILURE.UNANSWERED] as const;

export type RepositoryListFailure = (typeof REPOSITORY_LIST_FAILURES)[number];

/** The repositories the account reaches, as the window hears them: the service's answer whole, or why there is none. */
export const tasksRepositoriesAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ repositories: githubRepositoriesAnswerSchema }),
  EffectSchema.Struct({ failure: EffectSchema.Literals(REPOSITORY_LIST_FAILURES) }),
]);

export type TasksRepositoriesAnswer = typeof tasksRepositoriesAnswerSchema.Type;

/** A task's repository changed, as the window hears it: the repository the task now names, or why it is unchanged. */
export const tasksSetRepositoryAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ repository: EffectSchema.NullOr(EffectSchema.String) }),
  EffectSchema.Struct({ failure: repositoryCallFailureSchema }),
]);

export type TasksSetRepositoryAnswer = typeof tasksSetRepositoryAnswerSchema.Type;

/** A task moved, as the window hears it: the workspace it now belongs to, or why it stands where it was. */
export const tasksMoveAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ workspaceId: EffectSchema.String }),
  EffectSchema.Struct({ failure: EffectSchema.Literals(Object.values(TASK_CALL_FAILURE)) }),
]);

export type TasksMoveAnswer = typeof tasksMoveAnswerSchema.Type;

/** The developer's edit of a task's document, as the window asks it saved: the task, and the edit as the service takes it. */
export const tasksEditParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  edit: planEditRequestSchema,
});

export type TasksEditParams = typeof tasksEditParamsSchema.Type;

/** Why an edit saved nothing: the service did not answer, the task is gone or archived, or the plan would be longer than a plan may be. */
const EDIT_FAILURES = [
  TASK_CALL_FAILURE.UNANSWERED,
  TASK_CALL_FAILURE.NOT_FOUND,
  TASK_CALL_FAILURE.TASK_ARCHIVED,
  PLAN_EDIT_REFUSAL.TOO_LONG,
] as const;

export type TasksEditFailure = (typeof EDIT_FAILURES)[number];

/**
 * An edit as the window hears it: saved, the task arriving on the document
 * as the service answered it; a conflict, with what the field holds now; or
 * why nothing was saved.
 */
export const tasksEditAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ saved: EffectSchema.Literal(true) }),
  EffectSchema.Struct({ conflict: EffectSchema.Struct({ current: planEditValueSchema }) }),
  EffectSchema.Struct({ failure: EffectSchema.Literals(EDIT_FAILURES) }),
]);

export type TasksEditAnswer = typeof tasksEditAnswerSchema.Type;

/** A window of a file of a task's repository, as the File tab asks the host for it: the task, the path, and the window's first and last line. */
export const tasksFileParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  ...taskFileRequestSchema.fields,
});

export type TasksFileParams = typeof tasksFileParamsSchema.Type;

/** A window of a file as the File tab draws it: its place, the branch it was read on and the commit where the service named it, how long the whole file is, and its lines as this Mac coloured them. */
const taskFileShownSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  repository: EffectSchema.String,
  branch: EffectSchema.String,
  commit: EffectSchema.optionalKey(EffectSchema.String),
  firstLine: EffectSchema.Int,
  lineCount: EffectSchema.Int,
  lines: codeLinesSchema,
});

export type TaskFileShown = typeof taskFileShownSchema.Type;

/** The File tab's read, as the window hears it: the window coloured, the whole text read raw, why the file is not shown, or that the service did not answer. */
export const tasksFileAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ file: taskFileShownSchema }),
  EffectSchema.Struct({ text: taskFileTextSchema }),
  taskFileRefusalSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksFileAnswer = typeof tasksFileAnswerSchema.Type;

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
export const tasksTreeParamsSchema = EffectSchema.Union([
  EffectSchema.Struct({ planId: EffectSchema.NonEmptyString, ...taskTreeRequestSchema.fields }),
  EffectSchema.Struct({ ...repositoryPlaceFields, ...taskTreeRequestSchema.fields }),
]);

export type TasksTreeParams = typeof tasksTreeParamsSchema.Type;

/** The tree's read of a folder, as the window hears it: the folder listed, why it is not, or that the service did not answer. */
export const tasksTreeAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ folder: taskTreeFolderSchema }),
  taskFileRefusalSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksTreeAnswer = typeof tasksTreeAnswerSchema.Type;

/** The skills a developer may choose of a repository, as the window asks the host for them: the plan whose repository it is, or the workspace and the repository where no plan names it. */
export const tasksSkillsParamsSchema = EffectSchema.Union([
  EffectSchema.Struct({ planId: EffectSchema.NonEmptyString }),
  EffectSchema.Struct(repositoryPlaceFields),
]);

export type TasksSkillsParams = typeof tasksSkillsParamsSchema.Type;

/** The read of a repository's skills, as the window hears it: the skills, why they are not read, or that the service did not answer. */
export const tasksSkillsAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ skills: taskSkillsSchema }),
  taskFileRefusalSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksSkillsAnswer = typeof tasksSkillsAnswerSchema.Type;

/** One pull request of a repository, as a link to it asks the host for it: the workspace whose installation reaches the repository, the repository, and the pull request's number. */
export const tasksPullRequestParamsSchema = EffectSchema.Struct({
  ...repositoryPlaceFields,
  number: githubPullRequestNumberSchema,
});

export type TasksPullRequestParams = typeof tasksPullRequestParamsSchema.Type;

/** The read of one pull request, as the window hears it: the pull request, null where there is none to draw, or that the service did not answer. */
export const tasksPullRequestAnswerSchema = EffectSchema.Union([
  githubRepositoryPullRequestAnswerSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksPullRequestAnswer = typeof tasksPullRequestAnswerSchema.Type;

/** The pull request as a link that asked draws it, once the service answered: its number, title, page, and state, or null where there is none to draw. */
export const tasksPullRequestSchema = EffectSchema.NullOr(githubPullRequestSummarySchema);

export type TasksPullRequest = typeof tasksPullRequestSchema.Type;

/** One issue of a repository, as a link to it asks the host for it: the workspace whose installation reaches the repository, the repository, and the issue's number. */
export const tasksIssueParamsSchema = EffectSchema.Struct({
  ...repositoryPlaceFields,
  number: githubPullRequestNumberSchema,
});

export type TasksIssueParams = typeof tasksIssueParamsSchema.Type;

/** The read of one issue, as the window hears it: the issue, null where there is none to draw, or that the service did not answer. */
export const tasksIssueAnswerSchema = EffectSchema.Union([
  githubRepositoryIssueAnswerSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksIssueAnswer = typeof tasksIssueAnswerSchema.Type;

/** The issue as a link that asked draws it, once the service answered: its number, title, page, and state, or null where there is none to draw. */
export const tasksIssueSchema = EffectSchema.NullOr(githubIssueSummarySchema);

export type TasksIssue = typeof tasksIssueSchema.Type;

/** A page of a plan's history, as the version history asks the host for it: the task, and the revision the page is read before where it is an older page. */
export const tasksRevisionsParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  before: EffectSchema.optionalKey(planRevisionSeqSchema),
});

export type TasksRevisionsParams = typeof tasksRevisionsParamsSchema.Type;

/** The version history's read of a page, as the window hears it: the page as the service answered it, or that it did not answer. */
export const tasksRevisionsAnswerSchema = EffectSchema.Union([
  planRevisionsAnswerSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksRevisionsAnswer = typeof tasksRevisionsAnswerSchema.Type;

/** One revision of a plan, as the version history names it to read it or to restore it: the task and the revision's number. */
export const tasksRevisionParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  seq: planRevisionSeqSchema,
});

export type TasksRevisionParams = typeof tasksRevisionParamsSchema.Type;

/** The version history's read of one revision, as the window hears it: the revision beside the one before it, or that the service did not answer. */
export const tasksRevisionAnswerSchema = EffectSchema.Union([
  planRevisionAnswerSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksRevisionAnswer = typeof tasksRevisionAnswerSchema.Type;

/** One picture of a plan, as the window drawing it names it: the plan, and the picture's id its text names. */
export const tasksPictureParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  attachmentId: EffectSchema.NonEmptyString,
});

export type TasksPictureParams = typeof tasksPictureParamsSchema.Type;

/**
 * One picture of a plan, as the window hears it: its bytes in base64 under
 * its media type, which the window draws from a `data:` URL of its own
 * making, or why there is none: not the account's to read, or no answer.
 * The host fetched it under the account, so the window holds no bearer and
 * no address.
 */
export const tasksPictureAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ contentType: pictureTypeSchema, base64: EffectSchema.String }),
  EffectSchema.Struct({
    failure: EffectSchema.Literals([TASK_CALL_FAILURE.NOT_FOUND, TASK_CALL_FAILURE.UNANSWERED]),
  }),
]);

export type TasksPictureAnswer = typeof tasksPictureAnswerSchema.Type;

/** A picture kept on a plan, as the editor that took it asks: the plan, and the picture as a `data:` URL. */
export const tasksPictureKeepParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  picture: pictureDataUrlSchema,
});

export type TasksPictureKeepParams = typeof tasksPictureKeepParamsSchema.Type;

/** Why a picture was not kept: the plan holds its bound of pictures, the plan is not the account's to write, or no answer. */
export const PICTURE_KEEP_FAILURE = {
  TOO_MANY: "too-many",
  NOT_FOUND: TASK_CALL_FAILURE.NOT_FOUND,
  UNANSWERED: TASK_CALL_FAILURE.UNANSWERED,
} as const;

/** A picture kept, as the editor hears it: the id its text names it by, or why it was not kept. */
export const tasksPictureKeepAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ id: EffectSchema.NonEmptyString }),
  EffectSchema.Struct({ failure: EffectSchema.Literals(Object.values(PICTURE_KEEP_FAILURE)) }),
]);

export type TasksPictureKeepAnswer = typeof tasksPictureKeepAnswerSchema.Type;

/** One version of one page of a plan, as the frame drawing it names it. */
export const tasksPageParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  pageId: EffectSchema.NonEmptyString,
  version: pageVersionNumberSchema,
});

export type TasksPageParams = typeof tasksPageParamsSchema.Type;

/** A page frame's read of one version, as the window's process hears it: the version with its HTML, or that the service did not answer. */
export const tasksPageAnswerSchema = EffectSchema.Union([
  planPageVersionAnswerSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksPageAnswer = typeof tasksPageAnswerSchema.Type;

/** One plan's pages, as the window's Inbox names the plan whose item it shows. */
export const tasksPagesParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
});

export type TasksPagesParams = typeof tasksPagesParamsSchema.Type;

/** A plan's pages as the window hears them, each by its newest version, or that the service did not answer. */
export const tasksPagesAnswerSchema = EffectSchema.Union([
  taskPagesAnswerSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksPagesAnswer = typeof tasksPagesAnswerSchema.Type;

/** A page tab's read of one version's source, as the window hears it: its HTML line by line, coloured as HTML, or that the service did not answer. */
export const tasksPageSourceAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ lines: codeLinesSchema }),
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksPageSourceAnswer = typeof tasksPageSourceAnswerSchema.Type;

const workspaceCallFailureSchema = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(WORKSPACE_CALL_FAILURE)),
});

/** Making a workspace, as the window asks it: its name, as the service takes it; the account that asks owns it. */
export const tasksWorkspaceCreateParamsSchema = workspaceCreateRequestSchema;

export type TasksWorkspaceCreateParams = typeof tasksWorkspaceCreateParamsSchema.Type;

/** Renaming a workspace, as the window asks it: the workspace and its new name, as the service takes them. */
export const tasksWorkspaceRenameParamsSchema = workspaceRenameRequestSchema;

export type TasksWorkspaceRenameParams = typeof tasksWorkspaceRenameParamsSchema.Type;

/** Setting or removing a workspace's photo, as the window asks it: the workspace and the photo as a `data:` URL, or null, as the service takes them. */
export const tasksWorkspacePhotoSetParamsSchema = workspacePhotoSetRequestSchema;

export type TasksWorkspacePhotoSetParams = typeof tasksWorkspacePhotoSetParamsSchema.Type;

/** One workspace, as the window names it to read its invitations, or to connect or disconnect its GitHub organization. */
export const tasksWorkspaceParamsSchema = workspaceGithubRequestSchema;

export type TasksWorkspaceParams = typeof tasksWorkspaceParamsSchema.Type;

/** A workspace made, renamed, or given a photo, or its GitHub organization disconnected, as the window hears it: the workspace as it then stands, or why it does not. */
export const tasksWorkspaceAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ workspace: workspaceSchema }),
  workspaceCallFailureSchema,
]);

export type TasksWorkspaceAnswer = typeof tasksWorkspaceAnswerSchema.Type;

/** A GitHub organization's connection begun, as the window's process hears it: the Luke GitHub App's install address to open, or why there is none. */
export const tasksWorkspaceGitHubConnectAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ url: EffectSchema.String }),
  workspaceCallFailureSchema,
]);

export type TasksWorkspaceGitHubConnectAnswer = typeof tasksWorkspaceGitHubConnectAnswerSchema.Type;

/** The Linear issues a window asks for, to start a plan from one: the workspace, and a search where one is typed. */
export const tasksLinearIssuesParamsSchema = linearIssuesRequestSchema;

export type TasksLinearIssuesParams = typeof tasksLinearIssuesParamsSchema.Type;

/** The Linear issues as the window hears them: the issues the workspace's connection reaches, or why there are none. */
export const tasksLinearIssuesAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ issues: EffectSchema.Array(linearIssueSummarySchema) }),
  workspaceCallFailureSchema,
]);

export type TasksLinearIssuesAnswer = typeof tasksLinearIssuesAnswerSchema.Type;

/** A workspace's members, as the window asks for them: the workspace. */
export const tasksWorkspaceMembersParamsSchema = workspaceLeaveRequestSchema;

export type TasksWorkspaceMembersParams = typeof tasksWorkspaceMembersParamsSchema.Type;

/** Removing one member of a workspace, as the window asks it: the workspace and the member's account. */
export const tasksWorkspaceMemberRemoveParamsSchema = workspaceMemberRemovalSchema;

export type TasksWorkspaceMemberRemoveParams = typeof tasksWorkspaceMemberRemoveParamsSchema.Type;

/** Giving another member of a workspace a role, as the window asks it: the workspace, the member's account, and admin or member. */
export const tasksWorkspaceMemberRoleParamsSchema = workspaceMemberRoleSchema;

export type TasksWorkspaceMemberRoleParams = typeof tasksWorkspaceMemberRoleParamsSchema.Type;

/** Handing a workspace to one of its admins, as the window asks it: the workspace and the admin's account. */
export const tasksWorkspaceTransferParamsSchema = workspaceTransferSchema;

export type TasksWorkspaceTransferParams = typeof tasksWorkspaceTransferParamsSchema.Type;

/** A workspace's members, as the window hears them after a read, a removal, a role changed, or a handover: the members as they then stand, or why there are none. */
export const tasksWorkspaceMembersAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    members: EffectSchema.Array(workspaceMemberSchema),
    /** Who the workspace's work names but left, on a read; absent after a change, and from a service before it. */
    former: EffectSchema.optionalKey(EffectSchema.Array(formerMemberSchema)),
  }),
  workspaceCallFailureSchema,
]);

export type TasksWorkspaceMembersAnswer = typeof tasksWorkspaceMembersAnswerSchema.Type;

/** A workspace's photo, as a window's tile asks for it: the workspace. */
export const tasksWorkspacePhotoParamsSchema = workspaceLeaveRequestSchema;

export type TasksWorkspacePhotoParams = typeof tasksWorkspacePhotoParamsSchema.Type;

/**
 * A workspace's photo, as the window hears it: its bytes in base64 under
 * its media type, which the window draws from a `data:` URL of its own
 * making, or why there is none: not a member, no photo, or no answer. The
 * host fetched it under the account, so the window holds no bearer and no
 * address.
 */
export const tasksWorkspacePhotoAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ contentType: workspacePhotoTypeSchema, base64: EffectSchema.String }),
  workspaceCallFailureSchema,
]);

export type TasksWorkspacePhotoAnswer = typeof tasksWorkspacePhotoAnswerSchema.Type;

/** Leaving a workspace, as the window asks it: the workspace. */
export const tasksWorkspaceLeaveParamsSchema = workspaceLeaveRequestSchema;

export type TasksWorkspaceLeaveParams = typeof tasksWorkspaceLeaveParamsSchema.Type;

/** A leave, as the window hears it: left, the view's list then without it, or why not. */
export const tasksWorkspaceLeaveAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ left: EffectSchema.Literal(true) }),
  workspaceCallFailureSchema,
]);

export type TasksWorkspaceLeaveAnswer = typeof tasksWorkspaceLeaveAnswerSchema.Type;

/** An invitation, as the window asks for it: the workspace, the address, and the role. */
export const tasksWorkspaceInviteParamsSchema = workspaceInviteRequestSchema;

export type TasksWorkspaceInviteParams = typeof tasksWorkspaceInviteParamsSchema.Type;

/** An invitation made, as the window hears it: the invitation with its accept link, or why none was. */
export const tasksWorkspaceInvitationAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ invitation: workspaceInvitationSchema }),
  workspaceCallFailureSchema,
]);

export type TasksWorkspaceInvitationAnswer = typeof tasksWorkspaceInvitationAnswerSchema.Type;

/** A pending invitation canceled, as the window asks it: the workspace and the invitation. */
export const tasksWorkspaceInvitationCancelParamsSchema = workspaceInvitationCancelSchema;

export type TasksWorkspaceInvitationCancelParams =
  typeof tasksWorkspaceInvitationCancelParamsSchema.Type;

/** A workspace's pending invitations, as the window hears them after a read or a cancel, or why there are none. */
export const tasksWorkspaceInvitationsAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ invitations: EffectSchema.Array(workspaceInvitationSchema) }),
  workspaceCallFailureSchema,
]);

export type TasksWorkspaceInvitationsAnswer = typeof tasksWorkspaceInvitationsAnswerSchema.Type;

/** A page about the account's GitHub connection, as the window hears it: the address to open in the browser, or that the service did not answer. */
export const tasksGitHubPageAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ url: EffectSchema.String }),
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksGitHubPageAnswer = typeof tasksGitHubPageAnswerSchema.Type;

/** Why the account's GitHub was not disconnected: no answer, or GitHub is its only way to sign in. */
export const GITHUB_DISCONNECT_FAILURE = {
  UNANSWERED: TASK_CALL_FAILURE.UNANSWERED,
  NOT_PERMITTED: "not-permitted",
} as const;

/** A disconnect of the account's GitHub, as the window's process hears it: the connection as it then stands, or why it is not. */
export const tasksGitHubDisconnectAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ connection: githubConnectionSchema }),
  EffectSchema.Struct({
    failure: EffectSchema.Literals(Object.values(GITHUB_DISCONNECT_FAILURE)),
  }),
]);

export type TasksGitHubDisconnectAnswer = typeof tasksGitHubDisconnectAnswerSchema.Type;

/** Why a call about a plan's comments answered nothing to draw: no answer, or the plan is not the account's to read or write, an archived one for a write. */
export const PLAN_COMMENT_CALL_FAILURE = {
  UNANSWERED: TASK_CALL_FAILURE.UNANSWERED,
  NOT_FOUND: TASK_CALL_FAILURE.NOT_FOUND,
} as const;

const planCommentFailedSchema = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(PLAN_COMMENT_CALL_FAILURE)),
});

/** A plan's comments past a cursor, as the window asks it: the plan, and where the window stands. */
export const tasksCommentsParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  after: EffectSchema.NonEmptyString,
});

export type TasksCommentsParams = typeof tasksCommentsParamsSchema.Type;

/** A plan's comments as the window hears them: every thread and the cursor to read on from, or why there are none. */
export const tasksCommentsAnswerSchema = EffectSchema.Union([
  planCommentsAnswerSchema,
  planCommentFailedSchema,
]);

export type TasksCommentsAnswer = typeof tasksCommentsAnswerSchema.Type;

/** A thread started on a plan, as the window asks it. */
export const tasksCommentStartParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  start: planCommentStartRequestSchema,
});

export type TasksCommentStartParams = typeof tasksCommentStartParamsSchema.Type;

/** One thing done to one thread of a plan, as the window asks it. */
export const tasksCommentActParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  threadId: EffectSchema.NonEmptyString,
  action: planCommentActionRequestSchema,
});

export type TasksCommentActParams = typeof tasksCommentActParamsSchema.Type;

/** A write to a plan's comments as the window hears it: the thread as it stands, its deletion, a refusal, or why there is no answer. */
export const tasksCommentAnswerSchema = EffectSchema.Union([
  planCommentThreadAnswerSchema,
  planCommentFailedSchema,
]);

export type TasksCommentAnswer = typeof tasksCommentAnswerSchema.Type;
