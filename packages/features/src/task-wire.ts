import { Schema as EffectSchema } from "effect";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  codingAgentStartRequestFields,
  codingAgentSummarySchema,
  PULL_REQUEST_STATE,
  startBrief,
  tasklessAgentSchema,
} from "./coding-agent-wire.js";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { linearIssueIdSchema } from "./linear-wire.js";
import { pinPositionSchema } from "./pin-order.js";
import { countedNumber, memberRefSchema, wireUuidSchema } from "./service-wire.js";
import { sameIssueChoice, type TaskIssueChoice, taskIssueChoiceSchema } from "./task-issue-wire.js";

/**
 * task-wire.ts -- a named feature task and its one saved document, as the Tasks tab and the service read them.
 *
 * A task is its owner's name for it and one current document: one free
 * Markdown text (`plan-document.ts`, `docs/TASKS.md`), answered as the
 * document's `body` with no title line, since the name is its own, and an
 * empty `assumptions` list, since its assumptions are a section of the text;
 * the list stays on the wire because a desktop through v0.11.0 requires it.
 * The text is written by the task's notetaker and its coding agents through
 * notes, and by the developer whole. The service keeps every save as a
 * revision of the plan under the writer who made it, and a task carries its
 * newest as `lastEdit`, which is what the window's "Edited by" line reads,
 * and who last changed each section as `sectionEdits`, by heading.
 * A task may name the GitHub repository it is about, `owner/name` as
 * `github-repositories-wire.ts` spells it, which the service confirms the
 * account reaches through the Luke GitHub App before it keeps it; null is a
 * task with no repository yet, and every task from before repositories.
 * A task may be pinned, which the sidebar lists first, and archived, which
 * the list leaves out unless asked for it (`TASK_LIST_QUERY`), so a build
 * that knows nothing of archiving never sees an archived task. Both are the
 * account's, so they follow it to every Mac it signs in on.
 * A row of the list also says, in brief, what the task's coding agents are
 * doing and what they published (`taskAgentsSummarySchema`), so the sidebar
 * can mark a task at work or with a pull request without a read per row.
 * A task belongs to one workspace, which its summary names; a start names
 * the workspace it starts in, or none for the account's first one.
 * The starting account and the conversation a task resumes in are the
 * service's own and never travel here.
 *
 * Every request refuses a key it does not name, as every request frame on
 * this wire does, so a body cannot smuggle an account or a task id past the
 * bearer and the path that name them. Declared directly with Effect's
 * `Schema.Struct` and exported under its own name.
 *
 * Note that `planId`, `plan`, and `plans` keep the wire's legacy spelling of a task, because a
 * released desktop sends and reads them; they are renamed with the wire in a
 * follow-up, with no alias.
 */

export const TASK_BOUNDS = {
  /** The most characters a task's name may spell. */
  MAX_NAME_CHARS: 200,
  /** A document body past this is not a plan a coding agent can take in one prompt. */
  MAX_BODY_CHARS: 200_000,
  MAX_ASSUMPTIONS: 200,
  MAX_ASSUMPTION_CHARS: 2_000,
  /** The most characters a workspace's id may spell; the service mints them far shorter. */
  MAX_WORKSPACE_ID_CHARS: 200,
  /** The most characters a task's brief may spell: as many as a coding agent's prompt (`CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS`). */
  MAX_BRIEF_CHARS: 16_000,
  /** The most external issues one task may link (`task-issue-wire.ts`); a link past it is refused, and nothing is written. */
  MAX_ISSUES: 10,
} as const;

/** The name a plan started without one stands under until the developer renames it. */
export const UNTITLED_TASK_NAME = "Untitled";

/**
 * Where a task stands: filed for later, to do, under way, or settled one way
 * or the other. A task starts to do, and moves to in progress when a coding
 * agent first starts on it; archiving it is apart from where it stands.
 */
export const TASK_STATUS = {
  BACKLOG: "backlog",
  TODO: "todo",
  IN_PROGRESS: "in-progress",
  DONE: "done",
  CANCELED: "canceled",
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

/** The order a menu lists the statuses in: the order work moves through them, the settled last. */
export const TASK_STATUS_ORDER: readonly TaskStatus[] = [
  TASK_STATUS.BACKLOG,
  TASK_STATUS.TODO,
  TASK_STATUS.IN_PROGRESS,
  TASK_STATUS.DONE,
  TASK_STATUS.CANCELED,
];

/** How much a task matters; none is a task no one has weighed yet. */
export const TASK_PRIORITY = {
  NONE: "none",
  URGENT: "urgent",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
} as const;

export type TaskPriority = (typeof TASK_PRIORITY)[keyof typeof TASK_PRIORITY];

/** The order a menu lists the priorities in: the most pressing first, the unweighed last. */
export const TASK_PRIORITY_ORDER: readonly TaskPriority[] = [
  TASK_PRIORITY.URGENT,
  TASK_PRIORITY.HIGH,
  TASK_PRIORITY.MEDIUM,
  TASK_PRIORITY.LOW,
  TASK_PRIORITY.NONE,
];

export const taskStatusSchema = EffectSchema.Literals(Object.values(TASK_STATUS));

export const taskPrioritySchema = EffectSchema.Literals(Object.values(TASK_PRIORITY));

/** A task's number in its workspace, counted from one; its key is the workspace's prefix and this (`workspace-key.ts`). */
export const taskNumberSchema = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1));

/** A text settled with its ends trimmed, refused when nothing but whitespace stands, and bounded. */
function trimmedText(maximumChars: number) {
  return EffectSchema.Trim.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(maximumChars));
}

/**
 * A workspace's id as the service minted it: Better Auth's own generated
 * string rather than a UUID, so bounded text and nothing more.
 */
export const workspaceIdSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(TASK_BOUNDS.MAX_WORKSPACE_ID_CHARS),
);

export const planAssumptionSchema = EffectSchema.Struct({
  /** The assumption as one plain sentence. */
  text: trimmedText(TASK_BOUNDS.MAX_ASSUMPTION_CHARS),
});

/**
 * The default template's sections, in its order, by the names the fixed
 * template once kept them under: what its guidance and the prompts are keyed
 * by (`plan-template.ts`).
 */
export const PLAN_FIELD = {
  CONTEXT: "context",
  GOAL: "goal",
  APPROACH: "approach",
  INTERFACES: "interfaces",
  ALTERNATIVES: "alternatives",
  HARD_PARTS: "hardParts",
  NOT_DOING: "notDoing",
  PLAN_OF_ATTACK: "planOfAttack",
  TESTING: "testing",
  OPEN_QUESTIONS: "openQuestions",
  ASSUMPTIONS: "assumptions",
} as const;

export type PlanField = (typeof PLAN_FIELD)[keyof typeof PLAN_FIELD];

/** The one saved document of a task, replaced whole by every save. */
export const planDocumentSchema = EffectSchema.Struct({
  /** The plan's whole text, as written. */
  body: EffectSchema.String.check(EffectSchema.isMaxLength(TASK_BOUNDS.MAX_BODY_CHARS)),
  assumptions: EffectSchema.Array(planAssumptionSchema).check(
    EffectSchema.isMaxLength(TASK_BOUNDS.MAX_ASSUMPTIONS),
  ),
});

export type PlanDocument = typeof planDocumentSchema.Type;

/** A task's repository as a request names it: a full name, or null for none. */
const repositoryChoiceSchema = EffectSchema.NullOr(githubRepositoryFullNameSchema);

/**
 * The coding agent a task's start starts on it: an agent Start's own fields
 * (`coding-agent-wire.ts`), its key, which a retry carries again, the choice,
 * a prompt and its files, and the servers switched off, held to the same
 * words-or-files rule, but never `from` or a note, since a new task has no
 * agent to take over from. The prompt travels as `prompt`, the key the
 * desktop's own Start params name it by: the `task` an agent Start's body
 * spells it as is a released desktop's, which never sends this.
 */
export const taskAgentStartSchema = EffectSchema.Struct({
  idempotencyKey: codingAgentStartRequestFields.idempotencyKey,
  model: codingAgentStartRequestFields.model,
  effort: codingAgentStartRequestFields.effort,
  contextWindow: codingAgentStartRequestFields.contextWindow,
  prompt: codingAgentStartRequestFields.prompt,
  attachments: codingAgentStartRequestFields.attachments,
  disabledServers: codingAgentStartRequestFields.disabledServers,
}).check(startBrief);

export type TaskAgentStart = typeof taskAgentStartSchema.Type;

/** Whether a start asking for an agent asks for no planning phase beside it: the agent is the start, so no call is opened on the plan. */
function agentStartsUnplanned(request: { agent?: TaskAgentStart; planning?: boolean }): boolean {
  return request.agent === undefined || request.planning !== true;
}

/** Whether a start names its issues one way and each once: never `linearIssueId` beside `issues`, and no issue twice among them. */
function issuesNamedOnce(request: {
  linearIssueId?: string;
  issues?: readonly TaskIssueChoice[];
}): boolean {
  const issues = request.issues ?? [];
  if (request.linearIssueId !== undefined && issues.length > 0) return false;
  return issues.every((issue, index) =>
    issues.slice(index + 1).every((later) => !sameIssueChoice(issue, later)),
  );
}

/**
 * Starting a plan (POST): its name where one is given, the repository it is
 * about where one is chosen, the workspace it starts in where one is named,
 * the account's first workspace where none is, and the Linear issue it
 * starts from where one was picked, which the service reads through the
 * workspace's own Linear connection (`linear-wire.ts`), or the issues it
 * links from the start, Linear's and GitHub's, up to `TASK_BOUNDS.MAX_ISSUES`,
 * each named once and each with its relation (`task-issue-wire.ts`), a
 * GitHub issue only of the repository the task is about, which the service
 * reads itself, refusing the start where it reads none; and the workspace's
 * own issue it starts from where it was started from one (`issue-wire.ts`),
 * which must be an issue of the workspace it starts in; the document starts
 * as the untouched template, or empty where `planning` is false: a task
 * started without its planning phase, whose window opens no call on it
 * either. A name left out, or nothing but whitespace, starts the plan as
 * `UNTITLED_PLAN_NAME` until it is renamed. An `agent` starts a coding
 * agent on the task in the same request, as the agent's own Start would
 * (`taskAgentStartSchema`): it implies `planning: false`, so naming both is
 * refused, and the service refuses it without a repository, as it refuses
 * an agent's Start on a task with none, before anything is written. A
 * brief is the developer's own words about the task, which Luke is handed
 * beside the plan to plan from; one left out, or nothing but whitespace,
 * starts the task with none. A brief beside `planning: false` or an `agent`
 * is kept rather than refused, and goes unread until a call is opened on the
 * task, since that start opens none. A task starts to do and unweighed
 * unless `status` and `priority` say otherwise.
 */
export const taskCreateRequestSchema = EffectSchema.Struct({
  name: EffectSchema.optionalKey(
    EffectSchema.Trim.check(EffectSchema.isMaxLength(TASK_BOUNDS.MAX_NAME_CHARS)),
  ),
  workspaceId: EffectSchema.optionalKey(workspaceIdSchema),
  repository: EffectSchema.optionalKey(repositoryChoiceSchema),
  linearIssueId: EffectSchema.optionalKey(linearIssueIdSchema),
  issues: EffectSchema.optionalKey(
    EffectSchema.Array(taskIssueChoiceSchema).check(
      EffectSchema.isMaxLength(TASK_BOUNDS.MAX_ISSUES),
    ),
  ),
  issueId: EffectSchema.optionalKey(wireUuidSchema),
  planning: EffectSchema.optionalKey(EffectSchema.Boolean),
  agent: EffectSchema.optionalKey(taskAgentStartSchema),
  brief: EffectSchema.optionalKey(
    EffectSchema.Trim.check(EffectSchema.isMaxLength(TASK_BOUNDS.MAX_BRIEF_CHARS)),
  ),
  status: EffectSchema.optionalKey(taskStatusSchema),
  priority: EffectSchema.optionalKey(taskPrioritySchema),
}).check(EffectSchema.makeFilter(agentStartsUnplanned), EffectSchema.makeFilter(issuesNamedOnce));

export type TaskCreateRequest = typeof taskCreateRequestSchema.Type;

/** Renaming a task (PATCH): its new name, under the same rules as the name it started with. */
export const taskRenameRequestSchema = EffectSchema.Struct({
  name: trimmedText(TASK_BOUNDS.MAX_NAME_CHARS),
});

export type TaskRenameRequest = typeof taskRenameRequestSchema.Type;

/** Whether an update names anything to change: one that names nothing is refused rather than answered unchanged. */
function updateNamesAChange(update: {
  name?: string;
  repository?: string | null;
  pinned?: boolean;
  pinPosition?: string;
  archived?: boolean;
  workspaceId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
}): boolean {
  return Object.keys(update).length > 0;
}

/** Whether a position comes with the pin it places: a plan is given one only as it is pinned, never as it is unpinned. */
function positionIsPinned(update: { pinned?: boolean; pinPosition?: string }): boolean {
  return update.pinPosition === undefined || update.pinned === true;
}

/**
 * Changing a task (PATCH): its name, its repository, whether it is pinned,
 * where its pin stands in the sidebar's Pinned section (`pin-order.ts`),
 * which comes only with `pinned: true` and pins a plan not yet pinned,
 * whether it is archived, the workspace it moves to, where it stands, how
 * much it matters, or any of them at once. A rename is one of these; a repository is confirmed reachable by the
 * workspace before it is kept, and null clears it. A move is the task's
 * owner's alone, into a workspace they are a member of whose GitHub reaches
 * the task's repository.
 */
export const taskUpdateRequestSchema = EffectSchema.Struct({
  name: EffectSchema.optionalKey(trimmedText(TASK_BOUNDS.MAX_NAME_CHARS)),
  repository: EffectSchema.optionalKey(repositoryChoiceSchema),
  pinned: EffectSchema.optionalKey(EffectSchema.Boolean),
  pinPosition: EffectSchema.optionalKey(pinPositionSchema),
  archived: EffectSchema.optionalKey(EffectSchema.Boolean),
  workspaceId: EffectSchema.optionalKey(workspaceIdSchema),
  status: EffectSchema.optionalKey(taskStatusSchema),
  priority: EffectSchema.optionalKey(taskPrioritySchema),
}).check(EffectSchema.makeFilter(updateNamesAChange), EffectSchema.makeFilter(positionIsPinned));

export type TaskUpdateRequest = typeof taskUpdateRequestSchema.Type;

/** What a change of where a task stands names: its status, its priority, or both. */
export type TaskStanding = Pick<TaskUpdateRequest, "status" | "priority">;

/**
 * A repository the account pinned in the sidebar, and the instant it was
 * pinned: a pinned repository's group of tasks stands above the others,
 * newest pinned first. A pin is the account's, so it follows it to every
 * Mac it signs in on, as a task's pin does, and it names the repository and
 * nothing more, so pinning one asks GitHub nothing.
 */
export const repositoryPinSchema = EffectSchema.Struct({
  repository: githubRepositoryFullNameSchema,
  pinnedAt: countedNumber,
});

export type RepositoryPin = typeof repositoryPinSchema.Type;

export const REPOSITORY_PIN_BOUNDS = {
  /** The most repositories one account may hold pinned; a pin past it is refused, and nothing is written. */
  MAX_PINS: 50,
} as const;

/** The account's pinned repositories, newest pinned first (GET, and every PUT's answer). */
export const repositoryPinsAnswerSchema = EffectSchema.Struct({
  pins: EffectSchema.Array(repositoryPinSchema),
});

/** Pinning a repository, or unpinning it (PUT): asking twice for either moves nothing, and a pin keeps the instant it was first made. */
export const repositoryPinRequestSchema = EffectSchema.Struct({
  repository: githubRepositoryFullNameSchema,
  pinned: EffectSchema.Boolean,
});

/**
 * The task list's query (GET): `archived=include` lists the archived tasks
 * among the rest, each carrying its `archivedAt`. Without it they are left
 * out, which is what a build from before archiving asks.
 */
export const TASK_LIST_QUERY = {
  ARCHIVED: "archived",
} as const;

/** What the list's `archived` query may say. */
export const TASK_LIST_ARCHIVED = {
  INCLUDE: "include",
} as const;

const taskSummaryFields = {
  id: wireUuidSchema,
  /** The workspace the task belongs to. */
  workspaceId: workspaceIdSchema,
  name: trimmedText(TASK_BOUNDS.MAX_NAME_CHARS),
  /** Epoch milliseconds the task was started. */
  createdAt: countedNumber,
  /** Epoch milliseconds the document was last saved; the start, before any save. */
  updatedAt: countedNumber,
  /** The GitHub repository the task is about, `owner/name`; null before one is chosen. */
  repository: repositoryChoiceSchema,
  /**
   * The start again, answered only for a desktop through v0.7.1, which
   * refuses a summary without it; the list once ordered by the last open.
   * Optional here so no later build needs it, and nothing reads it. It goes
   * once a release that decodes it as optional has shipped and v0.7.1 is no
   * longer supported.
   */
  openedAt: EffectSchema.optionalKey(countedNumber),
  /** Epoch milliseconds the task was pinned; absent while it is not, and from a service before pinning. */
  pinnedAt: EffectSchema.optionalKey(countedNumber),
  /** Where the reader's pin stands in the sidebar's Pinned section once they dragged it (`pin-order.ts`); absent while it stands by `pinnedAt`. */
  pinPosition: EffectSchema.optionalKey(EffectSchema.String),
  /** Epoch milliseconds the task was archived; absent while it is not, and from a service before archiving. */
  archivedAt: EffectSchema.optionalKey(countedNumber),
  /**
   * The account that started the task, its owner, which alone may move it to
   * another workspace; absent from a service before it was sent.
   */
  ownerId: EffectSchema.optionalKey(EffectSchema.String),
  /**
   * The owner by id and the name their account holds now, as the task's ⋯
   * menu says who created it; absent once their account is gone, and from a
   * service before it was sent.
   */
  createdBy: EffectSchema.optionalKey(memberRefSchema),
  /**
   * The workspace's own issue the task was started from, which the issue's
   * page lists it under; absent for a task started from none, once that
   * issue is deleted or the task moved to another workspace, and from a
   * service before tasks were started from issues.
   */
  issueId: EffectSchema.optionalKey(wireUuidSchema),
  /** Where the task stands; absent from a service before tasks had one. */
  status: EffectSchema.optionalKey(taskStatusSchema),
  /** How much the task matters; absent from a service before tasks had one. */
  priority: EffectSchema.optionalKey(taskPrioritySchema),
  /** The task's number in its workspace, which its key is drawn from with the workspace's prefix; absent from a service before tasks had one. */
  number: EffectSchema.optionalKey(taskNumberSchema),
};

/** How much of a task's coding agents and their pull requests one row of the list names; its counts say how many stand in all. */
export const TASK_AGENTS_BOUNDS = {
  /** The most agents a row names: those at work first, then the newest started. */
  MAX_AGENTS: 3,
  /** The most pull requests a row names: the newest agent's first. */
  MAX_PULL_REQUESTS: 3,
} as const;

/** One of a task's coding agents as its row names it: what it is called and runs on, where it stands, since when, and who started it. */
export const taskAgentLineSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  /** The agent's title; null where it has none, when it is named by its model. */
  title: EffectSchema.NullOr(EffectSchema.String),
  /** AI Gateway's catalog id, such as `anthropic/claude-opus-5.5`. */
  model: EffectSchema.String,
  effort: EffectSchema.String,
  status: EffectSchema.Literals(Object.values(CODING_AGENT_STATUS)),
  /**
   * Epoch milliseconds: when its run began while it works, and when its
   * newest turn ended once it has; absent where neither is known.
   */
  at: EffectSchema.optionalKey(countedNumber),
  /**
   * The member who started the agent, whose provider key pays for it and
   * whose Mac its commands run on; absent once their account is gone, and
   * from a service before it.
   */
  startedBy: EffectSchema.optionalKey(memberRefSchema),
  /** The automation whose run started the agent; absent for one started by hand, once that automation is deleted, and from a service before it. */
  automationId: EffectSchema.optionalKey(wireUuidSchema),
});

export type TaskAgentLine = typeof taskAgentLineSchema.Type;

/** A pull request one of a task's agents opened, as GitHub last answered the service: where it stands and its size. */
export const taskPullRequestLineSchema = EffectSchema.Struct({
  number: countedNumber,
  title: EffectSchema.String,
  state: EffectSchema.Literals(Object.values(PULL_REQUEST_STATE)),
  checks: EffectSchema.Literals(Object.values(CHECK_SUMMARY)),
  additions: countedNumber,
  deletions: countedNumber,
  /** Its page on GitHub, which the hover card opens; absent from a service before it was sent. */
  url: EffectSchema.optionalKey(EffectSchema.String),
  /** The newest of the task's agents that opened it, whose Pull request tab a press on it opens; absent from a service before it was sent. */
  agentId: EffectSchema.optionalKey(wireUuidSchema),
});

export type TaskPullRequestLine = typeof taskPullRequestLineSchema.Type;

/**
 * What a task's coding agents are doing and what they published, in brief:
 * how many agents it has and how many of them are at work, the few the row
 * names, and the pull requests they opened, each counted once by its
 * number. A pull request is as the service last read it from GitHub, so
 * it may trail GitHub by as long as nothing has asked.
 */
export const taskAgentsSummarySchema = EffectSchema.Struct({
  total: countedNumber,
  /** The agents starting or running now. */
  working: countedNumber,
  /**
   * Epoch milliseconds the plan's agents last did something settled, every
   * agent's counted and not only those named: one started, handed a
   * message, or its turn ended. It holds still while a turn streams. Absent
   * from a service before it.
   */
  activityAt: EffectSchema.optionalKey(countedNumber),
  agents: EffectSchema.Array(taskAgentLineSchema).check(
    EffectSchema.isMaxLength(TASK_AGENTS_BOUNDS.MAX_AGENTS),
  ),
  pullRequestTotal: countedNumber,
  pullRequests: EffectSchema.Array(taskPullRequestLineSchema).check(
    EffectSchema.isMaxLength(TASK_AGENTS_BOUNDS.MAX_PULL_REQUESTS),
  ),
});

export type TaskAgentsSummary = typeof taskAgentsSummarySchema.Type;

/**
 * One row of the task list: everything but the document, and what its
 * coding agents are doing, which only the list answers, and only for a task
 * with an agent.
 */
export const taskSummarySchema = EffectSchema.Struct({
  ...taskSummaryFields,
  agents: EffectSchema.optionalKey(taskAgentsSummarySchema),
});

export type TaskSummary = typeof taskSummarySchema.Type;

/** The most saves by coding agents a task answers, newest last; the same bound the service keeps. */
const MAX_AGENT_EDITS = 50;

/** One save a coding agent made on the task, as the window reads it: the agent, how it is named now, and when. */
export const agentEditLineSchema = EffectSchema.Struct({
  agentId: wireUuidSchema,
  /** The agent as its row names it now: its title where it has one, else its model. */
  label: trimmedText(TASK_BOUNDS.MAX_NAME_CHARS),
  /** Epoch milliseconds of the save. */
  at: countedNumber,
});

/**
 * Who wrote a revision of a plan: the developer, the notetaker on a call
 * (whom the developer knows as Luke), a coding agent, or, for the one
 * revision a plan from before history starts with, nobody the service can
 * name.
 */
export const PLAN_ACTOR = {
  DEVELOPER: "developer",
  NOTETAKER: "notetaker",
  AGENT: "agent",
  EARLIER: "earlier",
} as const;

export type PlanActor = (typeof PLAN_ACTOR)[keyof typeof PLAN_ACTOR];

/**
 * The member a revision names: the developer whose edit or restore it is, or
 * the one whose call the notetaker wrote it on, by their account's id and the
 * name it holds now, a member who has since left the workspace among them.
 * The window calls the member You only where the id is its own account's.
 */
export const planEditorSchema = memberRefSchema;

export type PlanEditor = typeof planEditorSchema.Type;

/** The newest revision of a plan, as its "Edited by" line reads it. */
export const planLastEditSchema = EffectSchema.Struct({
  actor: EffectSchema.Literals(Object.values(PLAN_ACTOR)),
  /** The member who wrote it; absent for a coding agent's, for one nobody can be named for, and from a service before writers were kept. */
  by: EffectSchema.optionalKey(planEditorSchema),
  /** The coding agent as its row names it now; present only where a coding agent wrote it. */
  label: EffectSchema.optionalKey(trimmedText(TASK_BOUNDS.MAX_NAME_CHARS)),
  /** The coding agent that wrote it, which the window finds among the task's agents; absent for any other writer and from a service before it. */
  agentId: EffectSchema.optionalKey(wireUuidSchema),
  /** Epoch milliseconds of the revision's latest save. */
  at: countedNumber,
  /** Whether the revision was written on one of the task's calls. */
  duringCall: EffectSchema.Boolean,
});

export type PlanLastEdit = typeof planLastEditSchema.Type;

/** Bounds on the sections of a plan that is one document, as the window reads who last changed each. */
export const PLAN_SECTION_BOUNDS = {
  /** The most characters of a heading a section is known by; a longer heading is known by its first this many. */
  MAX_HEADING_CHARS: 1_000,
  /** The most sections a plan names a last save for. */
  MAX_SECTIONS: 500,
} as const;

/**
 * The revision that last changed one section of a plan that is one document,
 * as the section's "Edited by" line reads it: the section is known by its
 * heading's words, and a heading renamed with nothing beneath it changed
 * keeps the revision that last changed them.
 */
export const planSectionEditSchema = EffectSchema.Struct({
  section: EffectSchema.String.check(
    EffectSchema.isMaxLength(PLAN_SECTION_BOUNDS.MAX_HEADING_CHARS),
  ),
  ...planLastEditSchema.fields,
});

export type PlanSectionEdit = typeof planSectionEditSchema.Type;

/** One task with its saved document, its newest revision, who last changed each section, and the saves coding agents made on it, oldest first. */
export const taskSchema = EffectSchema.Struct({
  ...taskSummaryFields,
  document: planDocumentSchema,
  /** Optional on the wire so a task from a service without the journal still reads; none is no edits. */
  agentEdits: EffectSchema.optionalKey(
    EffectSchema.Array(agentEditLineSchema).check(EffectSchema.isMaxLength(MAX_AGENT_EDITS)),
  ),
  /** Absent for a task nobody has written since history began, and from a service before it. */
  lastEdit: EffectSchema.optionalKey(planLastEditSchema),
  /** The save that last changed each section, for the sections a save has changed; absent from a service before documents. */
  sectionEdits: EffectSchema.optionalKey(
    EffectSchema.Array(planSectionEditSchema).check(
      EffectSchema.isMaxLength(PLAN_SECTION_BOUNDS.MAX_SECTIONS),
    ),
  ),
});

export type Task = typeof taskSchema.Type;

/**
 * The plan list (GET): every plan the account owns, newest started first,
 * and beside them every agent with no plan in the account's workspaces,
 * newest started first, the archived ones of each only where the query asks
 * for them. The agents are absent from a service before them.
 */
export const taskListAnswerSchema = EffectSchema.Struct({
  plans: EffectSchema.Array(taskSummarySchema),
  planlessAgents: EffectSchema.optionalKey(EffectSchema.Array(tasklessAgentSchema)),
});

export type TaskListAnswer = typeof taskListAnswerSchema.Type;

/** A started, opened, or changed task (POST, GET, PATCH), with its document as saved. */
export const taskAnswerSchema = EffectSchema.Struct({ plan: taskSchema });

/**
 * Why the agent a start asked for was not started beside the task it made,
 * in the service's own word, as the agent's Start would have refused it.
 * Note that it carries no `unreached`, because the start confirmed the
 * repository reachable as it made the task.
 */
export const taskAgentRefusalSchema = EffectSchema.Struct({ error: EffectSchema.String });

export type TaskAgentRefusal = typeof taskAgentRefusalSchema.Type;

/**
 * A started task (POST): the task, and, where the start asked for an agent,
 * the agent started on it, or, the task made all the same, why the agent
 * was refused. A retry carrying the agent's key again answers the task and
 * the agent the first start made, and starts neither again.
 */
export const taskStartAnswerSchema = EffectSchema.Struct({
  plan: taskSchema,
  agent: EffectSchema.optionalKey(codingAgentSummarySchema),
  agentRefusal: EffectSchema.optionalKey(taskAgentRefusalSchema),
});

export type TaskStartAnswer = typeof taskStartAnswerSchema.Type;

/** A deleted task (DELETE): its row, its document, and its association are gone. */
export const taskDeleteAnswerSchema = EffectSchema.Struct({ deleted: EffectSchema.Literal(true) });

/** How a plan's history is read: the newest revisions first, a page at a time. */
export const PLAN_HISTORY_BOUNDS = {
  /** The most revisions one read of the history carries. */
  PAGE: 50,
} as const;

/** A revision's number within its plan, from one. */
export const planRevisionSeqSchema = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1));

/**
 * One revision as the version history lists it: its number, who wrote it and
 * when it last moved, the coding agent that wrote it or the call Luke wrote
 * it on where either did, when it began, how many changes its saves made, and, for the developer's restore
 * of an earlier revision, which one it brought back and that revision's
 * latest save.
 */
export const planRevisionLineSchema = EffectSchema.Struct({
  seq: planRevisionSeqSchema,
  lastEdit: planLastEditSchema,
  /** The coding agent that wrote it; absent for any other writer, once the agent's row is gone, and from a service before it. */
  agentId: EffectSchema.optionalKey(wireUuidSchema),
  /** The call Luke wrote it on, as the transcript names the call; absent for any other writer, a save off a call, and from a service before it. */
  callId: EffectSchema.optionalKey(wireUuidSchema),
  /** Epoch milliseconds of the revision's first save. */
  startedAt: countedNumber,
  changes: countedNumber,
  restoredFrom: EffectSchema.optionalKey(
    EffectSchema.Struct({ seq: planRevisionSeqSchema, at: countedNumber }),
  ),
});

export type PlanRevisionLine = typeof planRevisionLineSchema.Type;

/**
 * A page of a plan's history (GET `/api/plans/{id}/revisions`), the newest
 * first, before the revision the `before` query names where it names one;
 * `earlier` is what the next older page is read before, absent on the oldest.
 */
export const planRevisionsAnswerSchema = EffectSchema.Struct({
  revisions: EffectSchema.Array(planRevisionLineSchema).check(
    EffectSchema.isMaxLength(PLAN_HISTORY_BOUNDS.PAGE),
  ),
  earlier: EffectSchema.optionalKey(planRevisionSeqSchema),
});

export type PlanRevisionsAnswer = typeof planRevisionsAnswerSchema.Type;

/**
 * One revision's content (GET `/api/plans/{id}/revisions/{seq}`): the plan
 * as it stood after the revision and as it stood before it, null for the
 * first, each formatted under the task's name as it stands now, so a rename
 * since is no difference between them.
 */
export const planRevisionAnswerSchema = EffectSchema.Struct({
  revision: EffectSchema.Struct({
    seq: planRevisionSeqSchema,
    document: planDocumentSchema,
    previous: EffectSchema.NullOr(planDocumentSchema),
  }),
});

export type PlanRevisionAnswer = typeof planRevisionAnswerSchema.Type;

/** The most lines one code reference points at; a reference is a passage, not a file. */
const CODE_REF_MAX_LINES = 200;

/** The most characters of a path one code reference names: macOS's own bound. */
export const CODE_PATH_MAX_CHARS = 1_024;

/** A line of a file, counted from one. */
export const codeLineSchema = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1));

/**
 * A commit as GitHub names it: its whole SHA-1 in lowercase hex, and nothing
 * a branch, a tag, or a path could spell, so a read pinned to one asks
 * GitHub for exactly that commit.
 */
export const commitShaSchema = EffectSchema.String.check(
  EffectSchema.isMinLength(40),
  EffectSchema.isMaxLength(40),
  EffectSchema.isPattern(/^[0-9a-f]{40}$/u),
);

/** Whether a reference names both of its lines or neither, in order and within the bound. */
function codeRangeIsReadable(ref: { startLine?: number; endLine?: number }): boolean {
  if (ref.startLine === undefined || ref.endLine === undefined) {
    return ref.startLine === ref.endLine;
  }
  return ref.endLine >= ref.startLine && ref.endLine - ref.startLine < CODE_REF_MAX_LINES;
}

/**
 * A place in the task's repository: a file, named relative to the checkout
 * root, and the lines pointed at, or the file whole with none. Luke names one
 * through the brain's `show_code`.
 */
export const codeRefSchema = EffectSchema.Struct({
  path: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(CODE_PATH_MAX_CHARS),
  ),
  startLine: EffectSchema.optionalKey(codeLineSchema),
  endLine: EffectSchema.optionalKey(codeLineSchema),
}).check(EffectSchema.makeFilter(codeRangeIsReadable));

export type CodeRef = typeof codeRefSchema.Type;

export const SHOWN_CODE_BOUNDS = {
  /** The most lines one showing carries: the lines pointed at, with the file around them. */
  WINDOW_LINES: 200,
  /** The most characters of one line that travel; a longer line is cut there. */
  MAX_LINE_CHARS: 400,
  /** The most characters of the note Luke writes beside the lines: a sentence or two. */
  NOTE_CHARS: 280,
} as const;

/** What Luke says the lines are for, in a sentence or two of his own words, for the developer reading them. */
export const codeNoteSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(SHOWN_CODE_BOUNDS.NOTE_CHARS),
);

/**
 * Code on screen during a task call, with its lines: the place named,
 * the repository the service read it from, the window of the file it
 * holds around the lines pointed at, and Luke's note on why he showed it,
 * which code shown before notes were asked for does not carry. The service reads the lines from the
 * brain session's checkout of the repository as `show_code` runs, and
 * they travel in the call's own journal and on the `task.code` frame; the Mac
 * reads nothing of its own.
 */
export const shownCodeSchema = EffectSchema.Struct({
  ref: codeRefSchema,
  /** The repository the lines were read from, `owner/name`. */
  repository: githubRepositoryFullNameSchema,
  /** The commit the checkout stood at when the lines were read; absent on code shown before it was recorded. */
  commit: EffectSchema.optionalKey(commitShaSchema),
  /** The file's line the first carried line is. */
  firstLine: codeLineSchema,
  /** How many lines the whole file has. */
  lineCount: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1)),
  lines: EffectSchema.Array(
    EffectSchema.String.check(EffectSchema.isMaxLength(SHOWN_CODE_BOUNDS.MAX_LINE_CHARS)),
  ).check(EffectSchema.isMaxLength(SHOWN_CODE_BOUNDS.WINDOW_LINES)),
  note: EffectSchema.optionalKey(codeNoteSchema),
});

export type ShownCode = typeof shownCodeSchema.Type;

/** One window of a file: its first and last line, both counted from one. */
export interface CodeWindow {
  readonly first: number;
  readonly last: number;
}

/**
 * The window of a file of `lineCount` lines the screen holds for `ref`: the
 * lines pointed at centred where the file allows, and the file's head for a
 * reference with none.
 */
export function codeWindow(ref: CodeRef, lineCount: number): CodeWindow {
  const { WINDOW_LINES } = SHOWN_CODE_BOUNDS;
  const latest = Math.max(1, lineCount - WINDOW_LINES + 1);
  if (ref.startLine === undefined || ref.endLine === undefined) {
    return { first: 1, last: Math.min(lineCount, WINDOW_LINES) };
  }
  const pointed = ref.endLine - ref.startLine + 1;
  const margin = Math.max(0, Math.floor((WINDOW_LINES - pointed) / 2));
  const first = Math.min(Math.max(1, ref.startLine - margin), latest);
  return { first, last: Math.min(lineCount, first + WINDOW_LINES - 1) };
}

/** A file kept secret, refused wherever it sits in the repository: a `.env` file, or one whose name starts with `.env`. */
const SECRET_FILE = /(^|\/)\.env[^/]*$/u;

/** Whether a path names a secret file, which no reader reads, the service's or the window's asking. */
export function isSecretFile(path: string): boolean {
  return SECRET_FILE.test(path);
}

export const TASK_FILE_BOUNDS = {
  /** The most lines one read of a file for the File tab carries; a longer file is read a window at a time as it is scrolled. */
  WINDOW_LINES: 500,
  /** The longest text a raw read carries: the service reads a file of a megabyte at most, and its text, a character to a byte at least, is no longer. */
  MAX_TEXT_CHARS: 1024 * 1024,
} as const;

/**
 * Why a file of the task's repository was not read for the File tab, or a
 * folder not listed for its tree: a secret file, no regular file (or no
 * folder) at the path, a file too large or not text,
 * a task with no repository, a repository the Luke GitHub App does not
 * reach for the account, or GitHub not answering just now.
 */
export const TASK_FILE_REFUSAL = {
  SECRET: "secret",
  MISSING: "missing",
  NOT_TEXT: "not-text",
  NO_REPOSITORY: "no-repository",
  NOT_REACHABLE: "not-reachable",
  UNAVAILABLE: "unavailable",
} as const;

export type TaskFileRefusal = (typeof TASK_FILE_REFUSAL)[keyof typeof TASK_FILE_REFUSAL];

/** Whether a window names its lines in order and within the bound. */
function fileWindowIsReadable(window: { firstLine: number; lastLine: number }): boolean {
  return (
    window.lastLine >= window.firstLine &&
    window.lastLine - window.firstLine < TASK_FILE_BOUNDS.WINDOW_LINES
  );
}

/**
 * One window of a file of the task's repository, as the File tab asks it
 * (GET `/api/plans/{id}/file`): the path, and its first and last line; or,
 * with `raw`, the file's whole text, its lines uncut, as a copy or a
 * download of the file asks it, the window then standing for nothing. With
 * `ref`, the file is read as it stood at that commit, as an inbox item's
 * code reference pins it, rather than at the default branch's head.
 */
export const taskFileRequestSchema = EffectSchema.Struct({
  path: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(CODE_PATH_MAX_CHARS),
  ),
  firstLine: codeLineSchema,
  lastLine: codeLineSchema,
  raw: EffectSchema.optionalKey(EffectSchema.Boolean),
  ref: EffectSchema.optionalKey(commitShaSchema),
}).check(EffectSchema.makeFilter(fileWindowIsReadable));

export type TaskFileRequest = typeof taskFileRequestSchema.Type;

/**
 * A window of a file of the task's repository as it stands now on its
 * default branch, or at the commit the request pinned, read through the
 * Luke GitHub App: the path, the repository and the branch or commit read,
 * the commit the lines were read at where GitHub named one, the line the first carried line is, how
 * many lines the whole file has, and the lines, each cut as `show_code`
 * cuts it. A window past the file's end carries no lines.
 */
export const taskFileWindowSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  repository: githubRepositoryFullNameSchema,
  branch: EffectSchema.String,
  commit: EffectSchema.optionalKey(commitShaSchema),
  firstLine: codeLineSchema,
  lineCount: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1)),
  lines: EffectSchema.Array(
    EffectSchema.String.check(EffectSchema.isMaxLength(SHOWN_CODE_BOUNDS.MAX_LINE_CHARS)),
  ).check(EffectSchema.isMaxLength(TASK_FILE_BOUNDS.WINDOW_LINES)),
});

export type TaskFileWindow = typeof taskFileWindowSchema.Type;

/**
 * Why the File tab's file is not shown, and, where GitHub found nothing at
 * the path, the branch it was read on: the snippet came from the brain
 * session's checkout, which may hold a file that branch does not.
 */
export const taskFileRefusalSchema = EffectSchema.Struct({
  refusal: EffectSchema.Literals(Object.values(TASK_FILE_REFUSAL)),
  branch: EffectSchema.optionalKey(EffectSchema.String),
});

/** A file of the task's repository read raw: the path, the repository and the branch read, and the whole text as the file holds it. */
export const taskFileTextSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  repository: githubRepositoryFullNameSchema,
  branch: EffectSchema.String,
  text: EffectSchema.String.check(EffectSchema.isMaxLength(TASK_FILE_BOUNDS.MAX_TEXT_CHARS)),
});

/** The File tab's read answered: the window, the whole text where it was read raw, or why the file is not shown. */
export const taskFileAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ file: taskFileWindowSchema }),
  EffectSchema.Struct({ text: taskFileTextSchema }),
  taskFileRefusalSchema,
]);

export type TaskFileAnswer = typeof taskFileAnswerSchema.Type;

/** What an entry of a folder of the task's repository is, as the File tab's tree draws it: a folder opens into its own entries, and anything else is a file, read as a File tab reads one. */
export const TASK_TREE_ENTRY = {
  FILE: "file",
  FOLDER: "folder",
} as const;

export const TASK_TREE_BOUNDS = {
  /** The most entries one folder's listing carries; a folder holding more is listed to here and says it was cut. */
  MAX_ENTRIES: 5_000,
  /** The most entries a listing of everything under a folder carries, which the tree's search reads; one holding more is listed to here and says it was cut. */
  MAX_RECURSIVE_ENTRIES: 50_000,
} as const;

/**
 * One folder of the task's repository, as the File tab's tree asks it (GET
 * `/api/plans/{id}/tree`): its path from the repository's root, empty for
 * the root itself, and whether everything under it is asked, every entry
 * then named by its path from the folder, as the tree's search reads the
 * whole repository in one listing.
 */
export const taskTreeRequestSchema = EffectSchema.Struct({
  path: EffectSchema.String.check(EffectSchema.isMaxLength(CODE_PATH_MAX_CHARS)),
  recursive: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type TaskTreeRequest = typeof taskTreeRequestSchema.Type;

/** One entry of a folder: its name within the folder, its path from the folder in a recursive listing, and whether it is a folder or a file. */
export const taskTreeEntrySchema = EffectSchema.Struct({
  name: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(CODE_PATH_MAX_CHARS),
  ),
  kind: EffectSchema.Literals(Object.values(TASK_TREE_ENTRY)),
});

export type TaskTreeEntry = typeof taskTreeEntrySchema.Type;

/**
 * A folder of the task's repository as it stands now on the branch the
 * File tab reads its files on, through the Luke GitHub App: the path, the
 * repository and the branch read, its entries in GitHub's order, and
 * whether there were more than one listing carries. A secret file is
 * listed by name like any other, since it is its contents that are never
 * read.
 */
export const taskTreeFolderSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  repository: githubRepositoryFullNameSchema,
  branch: EffectSchema.String,
  entries: EffectSchema.Array(taskTreeEntrySchema).check(
    EffectSchema.isMaxLength(TASK_TREE_BOUNDS.MAX_RECURSIVE_ENTRIES),
  ),
  truncated: EffectSchema.Boolean,
});

/** The tree's read of one folder answered: its listing, or why it is not listed, in the File tab's own refusals. */
export const taskTreeAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ folder: taskTreeFolderSchema }),
  taskFileRefusalSchema,
]);

export type TaskTreeAnswer = typeof taskTreeAnswerSchema.Type;

export const TASK_SKILL_BOUNDS = {
  /** The most skills one read carries, which is as many as the service reads of a repository. */
  MAX_SKILLS: 64,
  /** The Agent Skills convention's bound on a skill's name. */
  MAX_NAME_CHARS: 64,
  /** The convention's bound on a description, past which the service cuts it. */
  MAX_DESCRIPTION_CHARS: 1024,
} as const;

/** One skill of the task's repository a developer may choose by name: the name its folder carries, the description a model routes on, and its `SKILL.md`, named from the repository's root, which the File tab opens. */
export const taskSkillSchema = EffectSchema.Struct({
  name: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(TASK_SKILL_BOUNDS.MAX_NAME_CHARS),
  ),
  description: EffectSchema.String.check(
    EffectSchema.isMaxLength(TASK_SKILL_BOUNDS.MAX_DESCRIPTION_CHARS),
  ),
  path: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(CODE_PATH_MAX_CHARS),
  ),
});

/**
 * The skills a developer may choose of the task's repository as it stands
 * now on its default branch, read through the Luke GitHub App (GET
 * `/api/plans/{id}/skills`): the repository and the branch read, and the
 * skills in name order. A skill its `SKILL.md` says the model alone loads
 * is not one of them.
 */
export const taskSkillsSchema = EffectSchema.Struct({
  repository: githubRepositoryFullNameSchema,
  branch: EffectSchema.String,
  skills: EffectSchema.Array(taskSkillSchema).check(
    EffectSchema.isMaxLength(TASK_SKILL_BOUNDS.MAX_SKILLS),
  ),
});

/** The read of the repository's skills answered: the skills, or why they are not read, in the File tab's own refusals. */
export const taskSkillsAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ skills: taskSkillsSchema }),
  taskFileRefusalSchema,
]);

export type TaskSkillsAnswer = typeof taskSkillsAnswerSchema.Type;
