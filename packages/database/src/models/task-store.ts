import { AUTOMATION_SCOPE } from "@luke/features/automation-wire";
import { CODING_AGENT_ARCHIVER, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { GITHUB_ACCESS, type GitHubAccess } from "@luke/features/github-repositories-wire";
import { INBOX_RESPONSE, INBOX_STATUS } from "@luke/features/inbox-wire";
import { planAttachmentIdsIn } from "@luke/features/plan-attachment-link";
import type { PlanSectionWriter } from "@luke/features/plan-document";
import { DEFAULT_PLAN_TEMPLATE } from "@luke/features/plan-document-template";
import { type PlanAgentEdit, planAgentEditSchema } from "@luke/features/plan-template";
import {
  PLAN_ACTOR,
  type PlanLastEdit,
  type PlanSectionEdit,
  TASK_PRIORITY,
  TASK_STATUS,
  type Task,
  type TaskOrigin,
  type TaskPriority,
  type TaskStatus,
  type TaskSummary,
  taskPrioritySchema,
  taskStatusSchema,
  UNKNOWN_AGENT_LABEL,
  UNTITLED_TASK_NAME,
} from "@luke/features/task-wire";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  type SQL,
  sql,
} from "drizzle-orm";
import { Data, DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { attachment } from "../schemas/attachment.js";
import { automation } from "../schemas/automation.js";
import { codingAgent, type StoredArchive } from "../schemas/coding-agent.js";
import { inboxItem } from "../schemas/inbox.js";
import { personalWorkspace } from "../schemas/personal-workspace.js";
import { conversations } from "../schemas/storage.js";
import { task, taskNumberCounter } from "../schemas/task.js";
import { taskPin } from "../schemas/task-pin.js";
import { taskSectionEntry } from "../schemas/task-section.js";
import { voiceSessions } from "../schemas/voice.js";
import { readPlanTemplate } from "./account-store.js";
import { followTaskArchive, moveTaskChat } from "./chat-store.js";
import { InstantColumnSchema } from "./columns.js";
import { stampSavedAttachments } from "./plan-attachments.js";
import { readLastEdit, readSectionWriters } from "./plan-revisions.js";
import { readTemplateAt } from "./plan-template-revisions.js";
import {
  linkTaskIssue,
  listTaskIssues,
  listTaskIssueTags,
  type NewTaskIssueLink,
  type TaskIssueLink,
} from "./task-issue-store.js";
import {
  isWorkspaceMember,
  reachableTask,
  readAccountNames,
  taskReachableBy,
} from "./workspace-store.js";

/**
 * task-store.ts -- the named tasks of an account's workspaces, and the one document each holds.
 *
 * A task is read and written by every member of the workspace it names,
 * whichever of them started it. Every statement here names the account it
 * runs for beside the task and gates on that account's membership
 * (`workspace-store.ts`), so a task of a workspace the account is not in
 * reads, saves, changes, and deletes exactly as an id that names nothing: as
 * no plan. An archive is a stamp on the row, so it is the workspace's and
 * reads alike for every member on every Mac; a pin is the reading member's
 * own (`plan-pin.ts`), so a plan of a shared workspace one member pinned
 * reads pinned for them alone, on every Mac they sign in on. A plan's repository is kept here as
 * handed and confirmed nowhere here: whether the account reaches it through
 * the Luke GitHub App is the route's to settle before it calls, on the
 * service that reads GitHub (`github/github-app.ts`), and so is whether the
 * account is a member of the workspace a task starts in. A save is one `update` over the row that
 * stands and never an insert, so a task deleted before a save lands stays
 * deleted, and a save that fails leaves the document as it was. A task's
 * coding agents' conversations go with the task: deleting the task stamps
 * them `deleted_at`, so the purge takes their words thirty days on. Every function is an effect over the ambient `SqlClient` and names
 * no database of its own.
 */

export type TaskStoreFailure = QueryError | Schema.SchemaError;

/** What a task store operation answers: an effect over the ambient client, composed into whatever called it. */
export type TaskStoreEffect<A> = Effect.Effect<A, TaskStoreFailure, DatabaseServices>;

/** The task is archived, so it takes the write asked of it only once it is brought back; nothing was written. */
export class TaskArchived extends Data.TaggedError("TaskArchived") {}

/** The member a task was to be assigned to is no member of its workspace, or of the one it moves to; nothing was written. */
export class TaskAssigneeNotMember extends Data.TaggedError("TaskAssigneeNotMember") {}

/** A coding agent stands on the task that its delete or its archive was not told was stopped: one started, or handed a message, while the others were stopped. */
export class TaskAgentUnstopped extends Data.TaggedError("TaskAgentUnstopped") {}

/** What a delete that stopped the task's agents first tells it. */
export interface TaskDeleteGuard<R> {
  /** The agents the caller stopped; any other standing refuses the delete. */
  readonly stoppedAgentIds: ReadonlySet<string>;
  /** Run under the task's lock before anything is deleted, given each agent's conversation. */
  readonly beforeDelete: (
    conversationIds: readonly string[],
  ) => Effect.Effect<void, QueryError | Schema.SchemaError, R>;
}

/**
 * What a change that moves a task runs first: given the repository the row
 * names under its lock, the caller's confirmation that the workspace it moves
 * to reaches it, so a repository changed while the move was asked cannot
 * ride into a workspace that does not reach it. Its failure leaves the task
 * unchanged.
 */
export type TaskMoveGuard<E, R> = (repository: string | null) => Effect.Effect<void, E, R>;

/** One of the plan's agents as its archive reads it, under its conversation's lock. */
export interface TaskArchivedAgent {
  readonly id: string;
  readonly conversationId: string;
  readonly createdAt: Date;
  /** Whether it was started blank, handed neither the plan nor a prompt. */
  readonly blank: boolean;
}

/**
 * What an archive of a plan whose agents the caller stopped first runs
 * under the plan's lock: whether each agent still stands stopped, read under
 * its conversation's lock, so one handed a message since refuses the archive.
 */
export type TaskArchiveGuard<R> = (
  agent: TaskArchivedAgent,
) => Effect.Effect<boolean, QueryError | Schema.SchemaError, R>;

/**
 * What a finish of a task's work runs under the task's lock: whether each
 * of its standing agents stands idle, neither starting nor running, read
 * under its conversation's lock, the same reading an archive's guard makes.
 */
export type TaskFinishGuard<R> = TaskArchiveGuard<R>;

/** One save a coding agent made, with the agent named as its row names it now. */
export interface LabelledAgentEdit extends PlanAgentEdit {
  readonly label: string;
}

/** A task as the service holds it: what the window reads, its text, and the saves coding agents made with their notes. */
export interface StoredTask {
  readonly task: Task;
  /** The account that started the task, the one that may move it to another workspace. */
  readonly ownerId: string;
  /** How the task's repository was reached as it was named: the workspace's GitHub App, or its owner's own token. */
  readonly githubAccess: GitHubAccess;
  /** The plan's whole text. */
  readonly text: string;
  readonly agentEdits: readonly LabelledAgentEdit[];
  /** Whether the text was ever saved since the task started: false while nobody has written it. */
  readonly saved: boolean;
  /** Who last changed each section, by heading, as its revisions read (`readSectionWriters`). */
  readonly sectionWriters: readonly PlanSectionWriter[];
  /** The external issues the task links, oldest linked first (`task-issue-store.ts`); none for a task that links none. */
  readonly issueLinks: readonly TaskIssueLink[];
  /** The developer's own words about the task as they started it; nothing for a task started with none. */
  readonly brief: string | undefined;
}

/**
 * A plan to start: the workspace it starts in, its name where one is given,
 * the repository it is about where one is chosen, the external issues it
 * links from the start, as the service read them, where any were picked. A plan started
 * with no name, or a blank one, stands as `UNTITLED_PLAN_NAME` until it is
 * renamed. A plan started with `planning` false skips its planning phase and
 * starts empty rather than as the template. A brief is the developer's own
 * words about the task, kept as written; a blank one is none.
 */
export interface NewTask {
  readonly organizationId: string;
  readonly name?: string;
  readonly repository?: string | null;
  /** How the repository was reached as it was named; the App's where none is named. */
  readonly githubAccess?: GitHubAccess;
  readonly issueLinks?: readonly NewTaskIssueLink[];
  readonly planning?: boolean;
  readonly brief?: string;
  /** Where the task stands as it starts; to do where none is named. */
  readonly status?: TaskStatus;
  /** How much the task matters as it starts; unweighed where none is named. */
  readonly priority?: TaskPriority;
  /** The member the task is assigned to as it starts, who must be a member of its workspace; no one where none is named. */
  readonly assigneeId?: string;
  /** Who made the task for its member, where they did not make it by hand: Luke on their call, or a coding agent by its id. */
  readonly origin?: TaskOrigin;
}

/**
 * What a change to a task names: a new name, a repository or null to clear
 * it, pinned or not, archived or not, the workspace it moves to, or any of
 * them at once. A move is its owner's alone, into a workspace they are a
 * member of, which the caller confirms first.
 */
export interface TaskChanges {
  readonly name?: string;
  readonly organizationId?: string;
  readonly repository?: string | null;
  /** How a repository the change names was reached, written with it; the App's where it names none. */
  readonly githubAccess?: GitHubAccess;
  readonly pinned?: boolean;
  /** Where the pin stands in the sidebar's Pinned section, which comes only with a pin. */
  readonly pinPosition?: string;
  readonly archived?: boolean;
  readonly status?: TaskStatus;
  readonly priority?: TaskPriority;
  /** The member the task is assigned to, who must be a member of its workspace, or of the one it moves to; null for no one. */
  readonly assigneeId?: string | null;
}

/** How a task's repository was reached, as a write takes it. */
const GitHubAccessSchema = Schema.Literals(Object.values(GITHUB_ACCESS));

/** Who made a task, as its row holds it. */
const TaskCreatorActorSchema = Schema.Literals([
  PLAN_ACTOR.DEVELOPER,
  PLAN_ACTOR.NOTETAKER,
  PLAN_ACTOR.AGENT,
]);

/**
 * The columns a line of the list reads: none of the document. Note that the
 * list projects these alone, because a migration that reshapes the document
 * lands before the build that reads the new shape is live, and a list that
 * decoded the document would then refuse every task rather than just the one
 * opened.
 */
const TASK_SUMMARY_COLUMNS = {
  id: task.id,
  userId: task.userId,
  organizationId: task.organizationId,
  name: task.name,
  number: task.number,
  status: task.status,
  priority: task.priority,
  assigneeId: task.assigneeId,
  creatorActor: task.creatorActor,
  creatorAgentId: task.creatorAgentId,
  repository: task.repository,
  githubAccess: task.githubAccess,
  archivedAt: task.archivedAt,
  completedAt: task.completedAt,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
};

/** The columns every other read and every `returning` projects, so a row decodes one way whatever wrote it. */
const TASK_COLUMNS = {
  ...TASK_SUMMARY_COLUMNS,
  agentEdits: task.agentEdits,
  document: task.document,
  brief: task.brief,
};

const TaskSummaryRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  organizationId: Schema.String,
  name: Schema.String,
  number: Schema.Number,
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  assigneeId: Schema.NullOr(Schema.String),
  creatorActor: TaskCreatorActorSchema,
  creatorAgentId: Schema.NullOr(Schema.String),
  repository: Schema.NullOr(Schema.String),
  githubAccess: GitHubAccessSchema,
  archivedAt: Schema.NullOr(InstantColumnSchema),
  completedAt: Schema.NullOr(InstantColumnSchema),
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

type TaskSummaryRow = typeof TaskSummaryRowSchema.Type;

/** The reader's own pin of a plan: when they pinned it, and where it stands once they dragged it; null where it stands by that instant. */
const ReaderPinSchema = Schema.Struct({
  pinnedAt: InstantColumnSchema,
  pinPosition: Schema.NullOr(Schema.String),
});

type ReaderPin = typeof ReaderPinSchema.Type;

/** A line of the list with the reader's own pin beside it; null where they hold none. */
const TaskListRowSchema = Schema.Struct({
  ...TaskSummaryRowSchema.fields,
  pinnedAt: Schema.NullOr(InstantColumnSchema),
  pinPosition: Schema.NullOr(Schema.String),
});

const TaskRowSchema = Schema.Struct({
  ...TaskSummaryRowSchema.fields,
  agentEdits: Schema.Array(planAgentEditSchema),
  // Every task is one document since the backfill, so a row with none is the store breaking its own contract.
  document: Schema.String,
  brief: Schema.NullOr(Schema.String),
});

type TaskRow = typeof TaskRowSchema.Type;

const TaskKeySchema = Schema.Struct({ userId: Schema.String, taskId: Schema.String });

const TaskIdRowSchema = Schema.Struct({ id: Schema.String });

/** The reader's own pin of the plan the row names, as a join reads it. */
function readersPin(userId: string): SQL | undefined {
  return and(eq(taskPin.taskId, task.id), eq(taskPin.userId, userId));
}

/** The reader's own pin of the plan; none where they hold none. */
const findPin = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: ReaderPinSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({ pinnedAt: taskPin.pinnedAt, pinPosition: taskPin.position })
        .from(taskPin)
        .where(and(eq(taskPin.userId, userId), eq(taskPin.taskId, taskId)))
        .limit(1),
    ),
});

/** The reader's pin of the plan, from now; one already standing keeps its instant. */
/**
 * The id of the transaction a write committed in, read in the write's own
 * `RETURNING`, as Neon's mutations guide says, so a client following the
 * task list waits for that transaction to arrive before it confirms the
 * write.
 */
const TXID = sql<string>`pg_current_xact_id()::text`;

/** The transaction a pin's write committed in; none where the pin stood as asked already. */
const TxidRowSchema = Schema.Struct({ txid: Schema.String });

const insertPin = SqlSchema.findOneOption({
  Result: TxidRowSchema,
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String, now: Schema.Date }),
  execute: ({ userId, taskId, now }) =>
    Database.use((db) =>
      db
        .insert(taskPin)
        .values({ userId, taskId, pinnedAt: now })
        .onConflictDoNothing()
        .returning({ txid: TXID }),
    ),
});

/** The reader's pin of the plan at the position given, from now where it was not pinned; one already standing keeps its instant and moves. */
const placePin = SqlSchema.findOneOption({
  Result: TxidRowSchema,
  Request: Schema.Struct({
    userId: Schema.String,
    taskId: Schema.String,
    position: Schema.String,
    now: Schema.Date,
  }),
  execute: ({ userId, taskId, position, now }) =>
    Database.use((db) =>
      db
        .insert(taskPin)
        .values({ userId, taskId, position, pinnedAt: now })
        .onConflictDoUpdate({ target: [taskPin.userId, taskPin.taskId], set: { position } })
        .returning({ txid: TXID }),
    ),
});

/** The reader's pin of the plan taken away; every other member's stands. */
const removePin = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: TxidRowSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .delete(taskPin)
        .where(and(eq(taskPin.userId, userId), eq(taskPin.taskId, taskId)))
        .returning({ txid: TXID }),
    ),
});

/** The agents the journal names, as their rows name them now; a row that is gone names nothing. */
const findAgentLabels = SqlSchema.findAll({
  Request: Schema.Struct({ taskId: Schema.String, agentIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({
    id: Schema.String,
    model: Schema.String,
    title: Schema.NullOr(Schema.String),
    personaName: Schema.NullOr(Schema.String),
  }),
  execute: ({ taskId, agentIds }) =>
    Database.use((db) =>
      db
        .select({
          id: codingAgent.id,
          model: codingAgent.model,
          title: codingAgent.title,
          personaName: codingAgent.personaName,
        })
        .from(codingAgent)
        .where(and(eq(codingAgent.taskId, taskId), inArray(codingAgent.id, agentIds))),
    ),
});

/**
 * The agents the journal and the sections' writers name, by id, as their rows
 * name them now, so a renamed agent reads renamed everywhere: the label is
 * the human name it was given, else the row's title, or its model while it has none. The row's own account is
 * the one they are read under.
 */
function agentLabelsOf(
  row: TaskRow,
  sectionWriters: readonly PlanSectionWriter[],
): TaskStoreEffect<ReadonlyMap<string, string>> {
  const named = [
    ...row.agentEdits.map((edit) => edit.agentId),
    ...sectionWriters.flatMap((writer) => (writer.agentId === undefined ? [] : [writer.agentId])),
  ];
  const agentIds = [...new Set(named)];
  if (agentIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findAgentLabels({ taskId: row.id, agentIds }),
    (agents) =>
      new Map(agents.map((agent) => [agent.id, agent.personaName ?? agent.title ?? agent.model])),
  );
}

/**
 * Who last changed one section, as its line reads it: a coding agent named by
 * its label, or as an agent whose row is gone, or whose writer was kept
 * before agents were; a member by their id and name, where one is named.
 */
function sectionEditOf(
  writer: PlanSectionWriter,
  labels: ReadonlyMap<string, string>,
): PlanSectionEdit {
  const { section, actor, at } = writer;
  const label = writer.agentId === undefined ? undefined : labels.get(writer.agentId);
  return {
    section,
    actor,
    ...(actor === PLAN_ACTOR.AGENT ? { label: label ?? UNKNOWN_AGENT_LABEL } : undefined),
    ...(writer.agentId === undefined ? undefined : { agentId: writer.agentId }),
    ...(writer.by === undefined ? undefined : { by: writer.by }),
    at,
    duringCall: writer.duringCall === true,
  };
}

/**
 * A coding agent's save from the journal as a plan's last edit, for a plan
 * whose history has not begun: an agent's save made before it is the newest
 * thing the service can name a writer for.
 */
function journaledEdit(edit: LabelledAgentEdit): PlanLastEdit {
  return {
    actor: PLAN_ACTOR.AGENT,
    label: edit.label,
    agentId: edit.agentId,
    at: edit.at,
    duringCall: false,
  };
}

/** The text the row's plan started as (`readStartedText`). */
function startedText(row: TaskRow): TaskStoreEffect<string> {
  return readStartedText(row.userId, row.createdAt.getTime());
}

/**
 * The row's plan, as the window and the model read it for `userId`, the
 * reader, whose own pin it carries: its text as the
 * document's body with no assumptions, since they are a section of the text,
 * and who last changed each section, as its revisions read. The row's own account is the one its
 * agents are read under. Its last edit is its newest revision, or, before its
 * history begins, the newest save a coding agent made. A task is saved once
 * a save has moved its last save past its start, which no creation and no
 * carrying over does.
 */
function storedTaskOf(userId: string, row: TaskRow): TaskStoreEffect<StoredTask> {
  return Effect.gen(function* () {
    const pin = Option.getOrNull(yield* findPin({ userId, taskId: row.id }));
    const summary = summaryOf(row, pin, yield* readAccountNames(namedAccountsOf([row])));
    const sectionWriters = yield* readSectionWriters(row.id, startedText(row));
    const labels = yield* agentLabelsOf(row, sectionWriters);
    const agentEdits = row.agentEdits.map((edit) => ({
      ...edit,
      label: labels.get(edit.agentId) ?? UNKNOWN_AGENT_LABEL,
    }));
    const lastEdit = Option.orElse(yield* readLastEdit(row.id), () =>
      Option.map(Option.fromUndefinedOr(agentEdits.at(-1)), journaledEdit),
    );
    return {
      task: {
        ...summary,
        agentEdits: agentEdits.map(({ agentId, label, at }) => ({ agentId, label, at })),
        ...(Option.isSome(lastEdit) ? { lastEdit: lastEdit.value } : undefined),
        document: { body: row.document, assumptions: [] },
        sectionEdits: sectionWriters.map((writer) => sectionEditOf(writer, labels)),
      },
      ownerId: row.userId,
      githubAccess: row.githubAccess,
      text: row.document,
      agentEdits,
      saved: row.updatedAt.getTime() > row.createdAt.getTime(),
      sectionWriters,
      issueLinks: yield* listTaskIssues(userId, row.id),
      brief: row.brief ?? undefined,
    };
  });
}

/** The row's plan alone, as the reader reads it, for the writes that answer one. */
function taskOf(userId: string, row: TaskRow): TaskStoreEffect<Task> {
  return Effect.map(storedTaskOf(userId, row), (stored) => stored.task);
}

/** The accounts a line of the list names: each row's owner, and its assignee where it has one. */
function namedAccountsOf(rows: readonly TaskSummaryRow[]): readonly string[] {
  return rows.flatMap((row) =>
    row.assigneeId === null ? [row.userId] : [row.userId, row.assigneeId],
  );
}

/**
 * The row as one line of the list, its owner and its assignee named by `names`. Note that
 * `openedAt` is still answered, as the start, because a desktop through
 * v0.7.1 refuses a summary without it. It goes once a release whose decoder
 * treats it as optional has shipped and v0.7.1 is no longer supported. A pin,
 * the reader's own `pinnedAt` and the `pinPosition` they dragged it to,
 * and an archive are answered only where they stand, so a plan that is
 * neither reads as every plan did before them; an owner whose account is
 * gone is named by nothing.
 */
function summaryOf(
  row: TaskSummaryRow,
  pin: ReaderPin | null,
  names: ReadonlyMap<string, string>,
): TaskSummary {
  const createdAt = row.createdAt.getTime();
  const owner = names.get(row.userId);
  const assignee = row.assigneeId === null ? undefined : names.get(row.assigneeId);
  return {
    id: row.id,
    workspaceId: row.organizationId,
    name: row.name,
    createdAt,
    updatedAt: row.updatedAt.getTime(),
    repository: row.repository,
    openedAt: createdAt,
    ownerId: row.userId,
    ...(owner === undefined ? undefined : { createdBy: { userId: row.userId, name: owner } }),
    ...originOf(row),
    ...(pin === null ? undefined : { pinnedAt: pin.pinnedAt.getTime() }),
    ...(pin === null || pin.pinPosition === null ? undefined : { pinPosition: pin.pinPosition }),
    ...(row.archivedAt === null ? undefined : { archivedAt: row.archivedAt.getTime() }),
    ...(row.completedAt === null ? undefined : { completedAt: row.completedAt.getTime() }),
    status: row.status,
    priority: row.priority,
    number: row.number,
    ...(row.assigneeId === null || assignee === undefined
      ? undefined
      : { assignee: { userId: row.assigneeId, name: assignee } }),
  };
}

/** Who made a task for its member, as the wire names them: nothing for a task made by hand. */
function originOf(row: TaskSummaryRow): { readonly origin?: TaskOrigin } {
  if (row.creatorActor === PLAN_ACTOR.DEVELOPER) return {};
  const agentId = row.creatorAgentId;
  return {
    origin: { actor: row.creatorActor, ...(agentId === null ? undefined : { agentId }) },
  };
}

const TaskInsertSchema = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  userId: Schema.String,
  organizationId: Schema.String,
  name: Schema.String,
  number: Schema.Number,
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  assigneeId: Schema.NullOr(Schema.String),
  creatorActor: TaskCreatorActorSchema,
  creatorAgentId: Schema.NullOr(Schema.String),
  repository: Schema.NullOr(Schema.String),
  githubAccess: GitHubAccessSchema,
  document: Schema.String,
  brief: Schema.NullOr(Schema.String),
  now: Schema.Date,
});

/** When a task that now stands in `status` was finished: now where it is Done or Canceled, none where it is open. */
function completedAtOf(status: TaskStatus, now: Date): Date | null {
  return status === TASK_STATUS.DONE || status === TASK_STATUS.CANCELED ? now : null;
}

/** A task's row as an insert writes it. */
function taskValues(write: typeof TaskInsertSchema.Type) {
  return {
    ...(write.id === undefined ? undefined : { id: write.id }),
    userId: write.userId,
    organizationId: write.organizationId,
    name: write.name,
    number: write.number,
    status: write.status,
    completedAt: completedAtOf(write.status, write.now),
    priority: write.priority,
    assigneeId: write.assigneeId,
    creatorActor: write.creatorActor,
    creatorAgentId: write.creatorAgentId,
    repository: write.repository,
    githubAccess: write.githubAccess,
    document: write.document,
    brief: write.brief,
    createdAt: write.now,
    updatedAt: write.now,
  };
}

const insertTask = SqlSchema.findOne({
  Request: TaskInsertSchema,
  Result: Schema.Struct({ ...TaskRowSchema.fields, txid: Schema.String }),
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(task)
        .values(taskValues(write))
        .returning({ ...TASK_COLUMNS, txid: TXID }),
    ),
});

/** A task inserted under its id where none stands under it yet; nothing where one does, written by nothing. */
const insertTaskOnce = SqlSchema.findOneOption({
  Request: TaskInsertSchema,
  Result: TaskRowSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(task)
        .values(taskValues(write))
        .onConflictDoNothing({ target: task.id })
        .returning(TASK_COLUMNS),
    ),
});

/**
 * The workspace's next task number, taken from its counter in one statement:
 * one for its first task, and one past the last it handed out after, so a
 * number is never handed out twice, though one taken by a write that then
 * failed is skipped.
 */
const takeTaskNumber = SqlSchema.findOne({
  Request: Schema.String,
  Result: Schema.Struct({ lastNumber: Schema.Number }),
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .insert(taskNumberCounter)
        .values({ organizationId, lastNumber: 1 })
        .onConflictDoUpdate({
          target: taskNumberCounter.organizationId,
          set: { lastNumber: sql`${taskNumberCounter.lastNumber} + 1` },
        })
        .returning({ lastNumber: taskNumberCounter.lastNumber }),
    ),
});

/** The number the workspace's next task takes. */
function nextTaskNumber(organizationId: string): TaskStoreEffect<number> {
  return takeTaskNumber(organizationId).pipe(
    Effect.map((taken) => taken.lastNumber),
    // An upsert that returned no row is the database breaking its own contract, not an outcome.
    Effect.catchTag("NoSuchElementError", Effect.die),
  );
}

const findTasks = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, includeArchived: Schema.Boolean }),
  Result: TaskListRowSchema,
  execute: ({ userId, includeArchived }) =>
    Database.use((db) =>
      db
        .select({
          ...TASK_SUMMARY_COLUMNS,
          pinnedAt: taskPin.pinnedAt,
          pinPosition: taskPin.position,
        })
        .from(task)
        .leftJoin(taskPin, readersPin(userId))
        .where(and(taskReachableBy(userId), includeArchived ? undefined : isNull(task.archivedAt)))
        .orderBy(desc(task.createdAt), desc(task.id)),
    ),
});

const findTask = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: TaskRowSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db.select(TASK_COLUMNS).from(task).where(reachableTask(userId, taskId)).limit(1),
    ),
});

const findTaskWorkspace = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: Schema.Struct({ organizationId: Schema.String }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({ organizationId: task.organizationId })
        .from(task)
        .where(reachableTask(userId, taskId))
        .limit(1),
    ),
});

/** The columns of a task `readTaskHeader` answers: every one but its plan's. */
const findTaskHeader = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: Schema.Struct({
    organizationId: Schema.String,
    userId: Schema.String,
    name: Schema.String,
    repository: Schema.NullOr(Schema.String),
    archived: Schema.Boolean,
  }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({
          organizationId: task.organizationId,
          userId: task.userId,
          name: task.name,
          repository: task.repository,
          archived: sql<boolean>`${task.archivedAt} is not null`,
        })
        .from(task)
        .where(reachableTask(userId, taskId))
        .limit(1),
    ),
});

const replaceText = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    taskId: Schema.String,
    text: Schema.String,
    agentEdits: Schema.optionalKey(Schema.Array(planAgentEditSchema)),
    now: Schema.Date,
  }),
  Result: TaskRowSchema,
  execute: ({ userId, taskId, text, agentEdits, now }) =>
    Database.use((db) =>
      db
        .update(task)
        .set({
          document: text,
          ...(agentEdits ? { agentEdits } : undefined),
          updatedAt: now,
        })
        .where(reachableTask(userId, taskId))
        .returning(TASK_COLUMNS),
    ),
});

/** The task row under its own lock, so a change and a save of the same task run one after the other. */
const lockTask = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: TaskRowSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db.select(TASK_COLUMNS).from(task).where(reachableTask(userId, taskId)).for("update"),
    ),
});

/** The columns of the row a change writes: the pin is the reader's own and none of the row's. */
const TaskColumnChangesSchema = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  organizationId: Schema.optionalKey(Schema.String),
  repository: Schema.optionalKey(Schema.NullOr(Schema.String)),
  githubAccess: Schema.optionalKey(GitHubAccessSchema),
  number: Schema.optionalKey(Schema.Number),
  status: Schema.optionalKey(taskStatusSchema),
  completedAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
  priority: Schema.optionalKey(taskPrioritySchema),
  assigneeId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  archivedAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
});

type TaskColumnChanges = typeof TaskColumnChangesSchema.Type;

/** The row changed: whichever of the name, the workspace and its number there, the repository, the status, the priority, the assignee, and the archive the change names, in one statement. */
const applyChanges = SqlSchema.findOne({
  Request: Schema.Struct({
    userId: Schema.String,
    taskId: Schema.String,
    ...TaskColumnChangesSchema.fields,
  }),
  Result: Schema.Struct({ ...TaskRowSchema.fields, txid: Schema.String }),
  execute: ({ userId, taskId, ...changes }) =>
    Database.use((db) =>
      db
        .update(task)
        .set(changes)
        .where(reachableTask(userId, taskId))
        .returning({ ...TASK_COLUMNS, txid: TXID }),
    ),
});

const removeTask = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: Schema.Struct({ id: Schema.String, txid: Schema.String }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db.delete(task).where(reachableTask(userId, taskId)).returning({ id: task.id, txid: TXID }),
    ),
});

const stampConversations = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationIds: Schema.Array(Schema.String),
    now: Schema.Date,
  }),
  Result: TaskIdRowSchema,
  execute: ({ conversationIds, now }) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({ deletedAt: now })
        .where(and(inArray(conversations.id, conversationIds), isNull(conversations.deletedAt)))
        .returning({ id: conversations.id }),
    ),
});

/**
 * The task's calls that have ended, and with them the words said on each,
 * which cascade with the session. A call still open is left to the sweep
 * (`purgeDeletedTaskCalls`), since the voice service still writes it and
 * the orphan sweep may still have to end it on Luke's key.
 */
const removeEndedCalls = SqlSchema.void({
  Request: TaskKeySchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .delete(voiceSessions)
        .where(
          and(
            eq(voiceSessions.userId, userId),
            eq(voiceSessions.taskId, taskId),
            isNotNull(voiceSessions.closedAt),
          ),
        ),
    ),
});

/** The conversations of the task's coding agents, read before the delete cascades the rows that name them. */
const findAgentConversations = SqlSchema.findAll({
  Request: TaskKeySchema,
  Result: Schema.Struct({ id: Schema.String, conversationId: Schema.String }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({ id: codingAgent.id, conversationId: codingAgent.conversationId })
        .from(codingAgent)
        .innerJoin(task, eq(task.id, codingAgent.taskId))
        .where(reachableTask(userId, taskId)),
    ),
});

/**
 * The name written only where the task still stands untitled and not
 * archived, so the check and the write are one statement and a name a
 * member gave the task meanwhile is never written over.
 */
const nameUntitled = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String, name: Schema.String }),
  Result: TaskIdRowSchema,
  execute: ({ userId, taskId, name }) =>
    Database.use((db) =>
      db
        .update(task)
        .set({ name })
        .where(
          and(
            reachableTask(userId, taskId),
            eq(task.name, UNTITLED_TASK_NAME),
            isNull(task.archivedAt),
          ),
        )
        .returning({ id: task.id }),
    ),
});

/**
 * The text an account's plan started as at `createdAt`, epoch milliseconds:
 * a copy of the account's template as it stood then, as its history reads,
 * or the template it holds now where it has no history. A note reads it to
 * tell a section still holding only its template's guidance.
 */
export function readStartedText(userId: string, createdAt: number): TaskStoreEffect<string> {
  return Effect.gen(function* () {
    const held = yield* readTemplateAt(userId, new Date(createdAt));
    const template = Option.isSome(held) ? held.value : yield* readPlanTemplate(userId);
    return template ?? DEFAULT_PLAN_TEMPLATE;
  });
}

/**
 * Starts a task under the account, in the workspace it was handed, as one
 * document, a copy of the account's own template or the default where it
 * keeps none, or empty where it skips its planning phase, with the
 * repository it was handed, and the issues it was handed linked to it in
 * the same transaction; it stands first in the list. A plan handed no
 * name, or a blank one, starts as
 * `UNTITLED_PLAN_NAME`. Note that the template is copied, not referred to,
 * because an edit of the template must leave every plan started from it as
 * it stands.
 */
/** A started task's row as it is inserted: its name, or Untitled, its plan's text, the template where it plans, and its brief, or none for a blank one. */
const insertOf = (userId: string, started: NewTask & { readonly id?: string }) =>
  Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const template = started.planning === false ? "" : yield* readPlanTemplate(userId);
    const named = started.name?.trim() ?? "";
    const brief = started.brief?.trim() ?? "";
    return {
      ...(started.id === undefined ? undefined : { id: started.id }),
      userId,
      organizationId: started.organizationId,
      name: named.length > 0 ? named : UNTITLED_TASK_NAME,
      repository: started.repository ?? null,
      githubAccess: started.githubAccess ?? GITHUB_ACCESS.APP,
      document: template ?? DEFAULT_PLAN_TEMPLATE,
      brief: brief.length > 0 ? brief : null,
      status: started.status ?? TASK_STATUS.TODO,
      priority: started.priority ?? TASK_PRIORITY.NONE,
      assigneeId: started.assigneeId ?? null,
      creatorActor: started.origin?.actor ?? PLAN_ACTOR.DEVELOPER,
      creatorAgentId: started.origin?.agentId ?? null,
      number: yield* nextTaskNumber(started.organizationId),
      now,
    };
  });

/** Refuses an assignee who is no member of the workspace with `TaskAssigneeNotMember`; no one assigned passes. */
function assigneeAdmitted(
  assigneeId: string | null | undefined,
  organizationId: string,
): Effect.Effect<void, TaskStoreFailure | TaskAssigneeNotMember, DatabaseServices> {
  if (assigneeId === undefined || assigneeId === null) return Effect.void;
  return Effect.flatMap(isWorkspaceMember(assigneeId, organizationId), (member) =>
    member ? Effect.void : Effect.fail(new TaskAssigneeNotMember()),
  );
}

/** A task as a write left it, and the transaction it committed in; none where it changed no row. */
export interface TaskCommitted<A> {
  readonly task: A;
  readonly txid?: string;
}

/**
 * Starts a task as `insertOf` writes it, with the issues it was handed
 * linked in the same transaction; an assignee who is no member of its
 * workspace refuses it with `TaskAssigneeNotMember`, nothing written.
 */
export function createTask(
  userId: string,
  started: NewTask,
): Effect.Effect<Task, TaskStoreFailure | TaskAssigneeNotMember, DatabaseServices> {
  return Effect.map(createTaskCommitted(userId, started), (created) => created.task);
}

/** A task started, as `createTask` starts one, and the transaction its row was written in. */
export function createTaskCommitted(
  userId: string,
  started: NewTask,
): Effect.Effect<TaskCommitted<Task>, TaskStoreFailure | TaskAssigneeNotMember, DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* assigneeAdmitted(started.assigneeId, started.organizationId);
        const { txid, ...row } = yield* insertTask(yield* insertOf(userId, started)).pipe(
          // An insert that returned no row is the database breaking its own contract, not an outcome.
          Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
        );
        for (const link of started.issueLinks ?? []) {
          yield* linkTaskIssue(userId, row.id, link).pipe(
            // A new task's links are its starter's few, each named once, on a task not yet archived, so a refusal is the caller breaking its contract.
            Effect.catchTags({
              TaskIssuesFull: Effect.die,
              TaskIssueLinked: Effect.die,
              TaskArchived: Effect.die,
            }),
          );
        }
        return { task: yield* taskOf(userId, row), txid };
      }),
    ),
  );
}

/**
 * Starts a task under the id its maker chose, as an agent's call makes one
 * under an id drawn from its own key, its plan's text the one given in the
 * template's place, where no task stands under that id yet; nothing where one
 * does, so the call run again, even at once, makes one task between them.
 */
export function createTaskOnce(
  userId: string,
  started: Omit<NewTask, "issueLinks"> & { readonly id: string; readonly text: string },
): Effect.Effect<Option.Option<Task>, TaskStoreFailure | TaskAssigneeNotMember, DatabaseServices> {
  return Effect.gen(function* () {
    yield* assigneeAdmitted(started.assigneeId, started.organizationId);
    const values = yield* insertOf(userId, { ...started, planning: false });
    const row = yield* insertTaskOnce({ ...values, document: started.text });
    return yield* Effect.transposeOption(Option.map(row, (made) => taskOf(userId, made)));
  });
}

/**
 * Every task of every workspace the account is a member of, newest started first, without their documents,
 * and without the archived ones unless `includeArchived` asks for them; each
 * with the issues it links, read for the whole list at once.
 * Nothing but starting a task moves the order: opening, reading, saving,
 * pinning, and archiving one leave every row where it stood, and the order a
 * pin draws is the window's to draw from `pinPosition` and `pinnedAt`.
 */
export function listTasks(
  userId: string,
  options: { readonly includeArchived?: boolean } = {},
): TaskStoreEffect<readonly TaskSummary[]> {
  return Effect.gen(function* () {
    const rows = yield* findTasks({ userId, includeArchived: options.includeArchived === true });
    const names = yield* readAccountNames(namedAccountsOf(rows));
    const tags = yield* listTaskIssueTags(
      userId,
      rows.map((row) => row.id),
    );
    return rows.map((row) => {
      const summary = summaryOf(
        row,
        row.pinnedAt === null ? null : { pinnedAt: row.pinnedAt, pinPosition: row.pinPosition },
        names,
      );
      const issues = tags.get(row.id);
      return issues === undefined ? summary : { ...summary, issues };
    });
  });
}

/**
 * The task with its saved document and its conversation, or nothing for a
 * task of a workspace the account is not in. This is the read the window opens a task
 * through and the brain starts and resumes from.
 */
export function readTask(
  userId: string,
  taskId: string,
): TaskStoreEffect<Option.Option<StoredTask>> {
  return Effect.flatMap(findTask({ userId, taskId }), (found) =>
    Effect.transposeOption(Option.map(found, (row) => storedTaskOf(userId, row))),
  );
}

/**
 * The workspace of a task the account reaches, as `readTask` would name it,
 * in one statement rather than the whole task: what a GitHub read of the
 * task's repository needs, once per agent where a delivery reads several.
 */
export function readTaskWorkspace(
  userId: string,
  taskId: string,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(
    findTaskWorkspace({ userId, taskId }),
    Option.map((row) => row.organizationId),
  );
}

/** A task as `readTaskHeader` reads it: where it stands and whose it is, without its plan. */
export interface TaskHeader {
  readonly workspaceId: string;
  readonly ownerId: string;
  readonly name: string;
  readonly repository: string | null;
  readonly archived: boolean;
}

/**
 * A task the account reaches, as `readTask` would answer it, in one
 * statement and without its plan, its history, or its issues: what a read
 * that only refuses a task, finds its workspace or its repository, or names
 * it needs. Nothing where the account reaches none.
 */
export function readTaskHeader(
  userId: string,
  taskId: string,
): TaskStoreEffect<Option.Option<TaskHeader>> {
  return Effect.map(
    findTaskHeader({ userId, taskId }),
    Option.map((row) => ({
      workspaceId: row.organizationId,
      ownerId: row.userId,
      name: row.name,
      repository: row.repository,
      archived: row.archived,
    })),
  );
}

/**
 * The task as `readTask` reads it, held under the row's lock until the
 * enclosing transaction ends, so a save formatted from it is not crossed by
 * a rename.
 */
export function readTaskForUpdate(
  userId: string,
  taskId: string,
): TaskStoreEffect<Option.Option<StoredTask>> {
  return Effect.flatMap(lockTask({ userId, taskId }), (locked) =>
    Effect.transposeOption(Option.map(locked, (row) => storedTaskOf(userId, row))),
  );
}

/** What a save of a document plan's text writes beside it, where it is handed. */
export interface PlanTextSaveExtras {
  /** The coding agents' journal. */
  readonly agentEdits?: readonly PlanAgentEdit[];
}

/**
 * Replaces the text of a task that is one document, with the agents' journal
 * where it is handed, stamps the plan's pictures the text names as saved, and answers
 * the task as saved, or nothing where the account reaches no such task; nothing
 * is ever created here.
 */
export function savePlanText(
  userId: string,
  taskId: string,
  text: string,
  extras: PlanTextSaveExtras = {},
): TaskStoreEffect<Option.Option<Task>> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const row = yield* replaceText({ userId, taskId, text, ...extras, now });
    // The pictures the text names are saved now, so the sweep leaves them for as long as the plan stands.
    if (Option.isSome(row)) yield* stampSavedAttachments(taskId, planAttachmentIdsIn(text, taskId));
    return yield* Effect.transposeOption(Option.map(row, (saved) => taskOf(userId, saved)));
  });
}

/**
 * The instant an archive stands from after a change: now where it is asked
 * for, the one already standing where it already was, so asking twice moves
 * nothing, and none where it is taken away.
 */
function stampOf(asked: boolean, standing: Date | null, now: Date): Date | null {
  if (!asked) return null;
  return standing ?? now;
}

/**
 * The columns of the row the change names, its archive stamped from the one
 * standing; none where it names only a pin. A move takes `movedNumber`, the
 * next number of the workspace it moves to. A status that moves stamps when
 * the task was finished (`completedAtOf`); one asked for as it already stands
 * leaves that stamp where it was.
 */
function columnChangesOf(
  changes: TaskChanges,
  standing: TaskRow,
  now: Date,
  movedNumber: number | undefined,
): TaskColumnChanges {
  return {
    ...(changes.name === undefined ? undefined : { name: changes.name }),
    ...(movedNumber === undefined || changes.organizationId === undefined
      ? undefined
      : { organizationId: changes.organizationId, number: movedNumber }),
    ...(changes.repository === undefined
      ? undefined
      : {
          repository: changes.repository,
          githubAccess: changes.githubAccess ?? GITHUB_ACCESS.APP,
        }),
    ...(changes.status === undefined || changes.status === standing.status
      ? undefined
      : { status: changes.status, completedAt: completedAtOf(changes.status, now) }),
    ...(changes.priority === undefined ? undefined : { priority: changes.priority }),
    ...(changes.assigneeId === undefined ? undefined : { assigneeId: changes.assigneeId }),
    ...(changes.archived === undefined
      ? undefined
      : { archivedAt: stampOf(changes.archived, standing.archivedAt, now) }),
  };
}

/**
 * The reader's own pin of the plan set as asked: from now, or from the
 * instant already standing, as an archive's stamp is, at the position given
 * where one is; or taken away. Every other member's pin stands as it was.
 */
function pinAsAsked(
  userId: string,
  taskId: string,
  pinned: boolean,
  position: string | undefined,
  now: Date,
): TaskStoreEffect<Option.Option<typeof TxidRowSchema.Type>> {
  if (!pinned) return removePin({ userId, taskId });
  return position === undefined
    ? insertPin({ userId, taskId, now })
    : placePin({ userId, taskId, position, now });
}

/**
 * The task's automations moved along with it: their workspace and their
 * repository follow the task's, so a task moved to another workspace, or
 * given another repository, leaves no automation naming the old one; one
 * moved into a personal workspace becomes personal, as everything there is.
 */
const followingAutomations = SqlSchema.void({
  Request: Schema.Struct({
    taskId: Schema.String,
    organizationId: Schema.String,
    repository: Schema.NullOr(Schema.String),
  }),
  execute: ({ taskId, organizationId, repository }) =>
    Database.use((db) =>
      db
        .update(automation)
        .set({
          organizationId,
          repositories: repository === null ? [] : [repository],
          // A personal workspace holds nothing shared, so an automation moved into one becomes its creator's.
          scope: sql`case when exists (select 1 from ${personalWorkspace} where ${personalWorkspace.organizationId} = ${organizationId}) then ${AUTOMATION_SCOPE.PERSONAL} else ${automation.scope} end`,
        })
        .where(eq(automation.taskId, taskId)),
    ),
});

/**
 * The task's agents and inbox moved along with it to another workspace, its
 * chat after them (`chat-store.ts`'s `moveTaskChat`), so
 * no row of the task's stays tied to the workspace it left, whose deletion
 * would otherwise take them with it.
 */
/**
 * Every member's entries for the plan taken out of their sections, as it
 * moves to another workspace: a section is one workspace's, so a plan that
 * leaves it leaves every section there, and one moved back later stands
 * under Tasks rather than where it once was kept.
 */
const leaveSections = SqlSchema.void({
  Request: Schema.String,
  execute: (taskId) =>
    Database.use((db) => db.delete(taskSectionEntry).where(eq(taskSectionEntry.taskId, taskId))),
});

const followingAgentsAndInbox = Effect.fnUntraced(function* (
  taskId: string,
  organizationId: string,
) {
  yield* Database.use((db) =>
    db.update(codingAgent).set({ organizationId }).where(eq(codingAgent.taskId, taskId)),
  );
  yield* Database.use((db) =>
    db.update(inboxItem).set({ organizationId }).where(eq(inboxItem.taskId, taskId)),
  );
  yield* Database.use((db) =>
    db.update(attachment).set({ organizationId }).where(eq(attachment.taskId, taskId)),
  );
});

/** The instant an archived task's open calls are stamped detached at: before any grace, so the sweep's next run takes them first. */
export const HANDED_TO_SWEEP_AT = new Date(0);

/**
 * Every open call on the task, whichever member opened it, handed to the
 * voice orphan sweep: stamped detached as of the epoch whether or not a
 * connection holds it, so the sweep's next run ends it on Luke's key and
 * each desktop on it hears `session.closed`; a re-attach is refused once
 * the task is archived, so nothing takes the call back.
 */
const handTaskCallsToSweep = SqlSchema.void({
  Request: Schema.Struct({ taskId: Schema.String, detachedAt: Schema.Date }),
  execute: (row) =>
    Database.use((db) =>
      db
        .update(voiceSessions)
        .set({ detachedAt: row.detachedAt })
        .where(and(eq(voiceSessions.taskId, row.taskId), isNull(voiceSessions.closedAt))),
    ),
});

/**
 * The task's agents still standing unarchived, each with its conversation
 * locked, the lock every write of its lines and turns takes, in the
 * conversations' order, so two archives of one task never wait on each other.
 */
const lockStandingAgents = SqlSchema.findAll({
  Request: Schema.Struct({ taskId: Schema.String }),
  Result: Schema.Struct({
    id: Schema.String,
    conversationId: Schema.String,
    createdAt: InstantColumnSchema,
    blank: Schema.Boolean,
  }),
  execute: ({ taskId }) =>
    Database.use((db) =>
      db
        .select({
          id: codingAgent.id,
          conversationId: codingAgent.conversationId,
          createdAt: codingAgent.createdAt,
          blank: sql<boolean>`${codingAgent.planSnapshot} is null and ${codingAgent.prompt} is null`,
        })
        .from(codingAgent)
        .innerJoin(conversations, eq(conversations.id, codingAgent.conversationId))
        .where(and(eq(codingAgent.taskId, taskId), isNull(codingAgent.archivedAt)))
        .orderBy(conversations.id)
        .for("update", { of: conversations }),
    ),
});

/**
 * The task's standing agents archived with it, at the task's own stamp and
 * as the member who archived it, once the guard, where one is handed, reads
 * every one of them stopped under its conversation's lock.
 */
const archivedAgents = Effect.fnUntraced(function* <R>(
  userId: string,
  taskId: string,
  archivedAt: Date,
  guard: TaskArchiveGuard<R> | undefined,
) {
  const agents = yield* lockStandingAgents({ taskId });
  if (agents.length === 0) return;
  if (guard !== undefined) {
    const stopped = yield* Effect.forEach(agents, guard);
    if (stopped.includes(false)) return yield* new TaskAgentUnstopped();
  }
  const archivedBy: StoredArchive = { by: CODING_AGENT_ARCHIVER.MEMBER, userId, withTask: true };
  const agentIds = agents.map(({ id }) => id);
  yield* Database.use((db) =>
    db
      .update(codingAgent)
      .set({ archivedAt, archivedBy })
      .where(and(inArray(codingAgent.id, agentIds), isNull(codingAgent.archivedAt))),
  );
});

/** The agents the task's archive at `archivedAt` archived with it brought back with it; one archived on its own stays archived. */
const unarchivedAgents = (taskId: string, archivedAt: Date) =>
  Database.use((db) =>
    db
      .update(codingAgent)
      .set({ archivedAt: null, archivedBy: null })
      .where(
        and(
          eq(codingAgent.taskId, taskId),
          eq(codingAgent.archivedAt, archivedAt),
          sql`(${codingAgent.archivedBy} ->> 'withTask') = 'true'`,
        ),
      ),
  );

/**
 * Changes the task, a new name with its document's heading, a repository or
 * none, pinned or not, archived or not, its workspace, and answers it as
 * changed, or nothing where the account reaches no such task. The changes
 * arrive already read under the wire's rules, and a repository already
 * confirmed reachable; a move runs the caller's guard under the row's lock
 * on the repository the task will name once it lands. A change is
 * not a save: the document's `updatedAt` and the list's order stand. The pin
 * is the account's own and no other member's, and a pin
 * and an archive are kept apart, so a pinned task archived and brought back
 * is pinned again. An archived task is neither renamed nor given another
 * repository, read under the same lock, unless the same change brings it
 * back; its pin and its archive still change.
 *
 * A task's archive archives its coding agents with it, under the same stamp
 * and as the member who archived the task (`archivedAgents`), and its
 * unarchive brings back those agents and no other, so one archived on its
 * own before stays archived. Where the caller hands `archiveGuard`, each
 * agent is read under its conversation's lock and the whole change refused
 * with `TaskAgentUnstopped`, nothing written, where any stands at work.
 */
export function updateTask<E = never, R = never, RA = never>(
  userId: string,
  taskId: string,
  changes: TaskChanges,
  moveGuard?: TaskMoveGuard<E, R>,
  archiveGuard?: TaskArchiveGuard<RA>,
): Effect.Effect<
  Option.Option<Task>,
  TaskStoreFailure | TaskArchived | TaskAgentUnstopped | TaskAssigneeNotMember | E,
  DatabaseServices | R | RA
> {
  return Effect.map(
    updateTaskCommitted(userId, taskId, changes, moveGuard, archiveGuard),
    Option.map((updated) => updated.task),
  );
}

/**
 * A task changed, as `updateTask` changes one, and the transaction the change
 * committed in, read from the write that changed the row or the reader's pin;
 * none where the change wrote neither.
 */
export function updateTaskCommitted<E = never, R = never, RA = never>(
  userId: string,
  taskId: string,
  changes: TaskChanges,
  moveGuard?: TaskMoveGuard<E, R>,
  archiveGuard?: TaskArchiveGuard<RA>,
): Effect.Effect<
  Option.Option<TaskCommitted<Task>>,
  TaskStoreFailure | TaskArchived | TaskAgentUnstopped | TaskAssigneeNotMember | E,
  DatabaseServices | R | RA
> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockTask({ userId, taskId });
        if (Option.isNone(locked)) return Option.none();
        const stillArchived = locked.value.archivedAt !== null && changes.archived !== false;
        const reworded =
          changes.name !== undefined ||
          changes.repository !== undefined ||
          changes.organizationId !== undefined ||
          changes.status !== undefined ||
          changes.priority !== undefined ||
          changes.assigneeId !== undefined;
        if (stillArchived && reworded) return yield* new TaskArchived();
        if (changes.organizationId !== undefined && moveGuard !== undefined) {
          yield* moveGuard(
            changes.repository === undefined ? locked.value.repository : changes.repository,
          );
        }
        const now = yield* DateTime.nowAsDate;
        const standing = locked.value.archivedAt;
        // An archive asked again takes in an agent brought back on its own since, under the standing stamp.
        if (changes.archived === true) {
          yield* archivedAgents(userId, taskId, standing ?? now, archiveGuard);
        }
        if (changes.archived === false && standing !== null) {
          yield* unarchivedAgents(taskId, standing);
        }
        const pinned =
          changes.pinned === undefined
            ? Option.none()
            : yield* pinAsAsked(userId, taskId, changes.pinned, changes.pinPosition, now);
        const moved =
          changes.organizationId !== undefined &&
          changes.organizationId !== locked.value.organizationId;
        // A task moved to another workspace takes the next number there; its old one is never handed out again.
        const movedNumber = moved ? yield* nextTaskNumber(changes.organizationId) : undefined;
        const landsIn = moved ? changes.organizationId : locked.value.organizationId;
        yield* assigneeAdmitted(changes.assigneeId, landsIn);
        // A task moved where its assignee is no member goes unassigned rather than assigned to someone who cannot read it.
        const unassigned =
          moved &&
          changes.assigneeId === undefined &&
          locked.value.assigneeId !== null &&
          !(yield* isWorkspaceMember(locked.value.assigneeId, landsIn));
        const columns = columnChangesOf(
          unassigned ? { ...changes, assigneeId: null } : changes,
          locked.value,
          now,
          movedNumber,
        );
        // A change that names only a pin writes nothing of the row, and an update with nothing to set is no statement.
        const { txid: written, ...row } =
          Object.keys(columns).length === 0
            ? { ...locked.value, txid: undefined }
            : yield* applyChanges({ userId, taskId, ...columns }).pipe(
                // The row is held under this transaction's lock, so an update that missed it is the database breaking its own contract.
                Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
              );
        const txid = written ?? Option.getOrUndefined(pinned)?.txid;
        if (changes.organizationId !== undefined || changes.repository !== undefined) {
          yield* followingAutomations({
            taskId,
            organizationId: row.organizationId,
            repository: row.repository,
          });
        }
        if (changes.organizationId !== undefined) {
          yield* followingAgentsAndInbox(taskId, row.organizationId);
          yield* moveTaskChat(taskId, row.organizationId);
          if (row.organizationId !== locked.value.organizationId) yield* leaveSections(taskId);
        }
        if (changes.archived !== undefined) yield* followTaskArchive(taskId, row.archivedAt);
        if (changes.archived === true) {
          yield* handTaskCallsToSweep({ taskId, detachedAt: HANDED_TO_SWEEP_AT });
        }
        const changed = yield* taskOf(userId, row);
        return Option.some(txid === undefined ? { task: changed } : { task: changed, txid });
      }),
    ),
  );
}

/**
 * Names a task that still stands as `UNTITLED_TASK_NAME`, as its first
 * coding agent's generated title does; false, and nothing written, where
 * the task has a name of its own, is archived, or is no task the account
 * reaches. A rename, like `updateTask`'s, is not a save, so the list's
 * order and the document stand.
 */
export function nameUntitledTask(
  userId: string,
  taskId: string,
  name: string,
): TaskStoreEffect<boolean> {
  const named = name.trim();
  if (named.length === 0) return Effect.succeed(false);
  return Effect.map(nameUntitled({ userId, taskId, name: named }), Option.isSome);
}

const assignUnassigned = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: TxidRowSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .update(task)
        .set({ assigneeId: userId })
        .where(and(reachableTask(userId, taskId), isNull(task.assigneeId)))
        .returning({ txid: TXID }),
    ),
});

/**
 * Assigns a task no one is assigned to the account, as a coding agent it
 * started on the task by hand does, and answers whether it did. A task
 * already assigned, to the account or anyone else, stands as it was, and so
 * does one the account does not reach, which a member alone does; the check
 * and the write are one statement, and like any change it is not a save.
 */
export function assignUnassignedTask(userId: string, taskId: string): TaskStoreEffect<boolean> {
  return Effect.map(assignUnassignedTaskCommitted(userId, taskId), Option.isSome);
}

/** The task assigned, as `assignUnassignedTask` assigns it, and the transaction it committed in; none where it stood as it was. */
export function assignUnassignedTaskCommitted(
  userId: string,
  taskId: string,
): TaskStoreEffect<Option.Option<{ readonly txid: string }>> {
  return assignUnassigned({ userId, taskId });
}

const beginTask = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: TxidRowSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .update(task)
        .set({ status: TASK_STATUS.IN_PROGRESS, completedAt: null })
        .where(and(reachableTask(userId, taskId), ne(task.status, TASK_STATUS.IN_PROGRESS)))
        .returning({ txid: TXID }),
    ),
});

/**
 * Moves a task to in progress, as a coding agent started on it or a turn of
 * one starting on it does, and answers whether it moved: one whose work has
 * not begun, in the backlog or to do, and one settled, done or canceled,
 * which the work reopens. A task already in progress, and one the account
 * does not reach, stand as they were, so asking again moves nothing. Like
 * any change it is not a save, so the list's order stands; the check and
 * the write are one statement.
 */
export function beginTaskWork(userId: string, taskId: string): TaskStoreEffect<boolean> {
  return Effect.map(beginTaskWorkCommitted(userId, taskId), Option.isSome);
}

/** The task moved to in progress, as `beginTaskWork` moves it, and the transaction it committed in; none where it stood as it was. */
export function beginTaskWorkCommitted(
  userId: string,
  taskId: string,
): TaskStoreEffect<Option.Option<{ readonly txid: string }>> {
  return beginTask({ userId, taskId });
}

/** The statuses a task's work is settled in, which a finish leaves as they are and a start or a turn reopens. */
const SETTLED: readonly TaskStatus[] = [TASK_STATUS.DONE, TASK_STATUS.CANCELED];

/** The pull request states under which an agent's pull request still waits on review or on being marked ready. */
const OPEN_PULL_REQUEST_STATES: readonly string[] = [
  PULL_REQUEST_STATE.OPEN,
  PULL_REQUEST_STATE.DRAFT,
];

/** Where the pull requests of the task's standing agents stand, as their rows keep them; an agent whose row keeps none has no line here. */
const findStandingPullRequestStates = SqlSchema.findAll({
  Request: Schema.Struct({ taskId: Schema.String }),
  Result: Schema.Struct({ state: Schema.String }),
  execute: ({ taskId }) =>
    Database.use((db) =>
      db
        .select({ state: sql<string>`${codingAgent.published} ->> 'state'` })
        .from(codingAgent)
        .where(
          and(
            eq(codingAgent.taskId, taskId),
            isNull(codingAgent.archivedAt),
            isNotNull(codingAgent.published),
          ),
        ),
    ),
});

/**
 * One inbox item of the task holding a question open for the developer:
 * open, and asking something, which a notice, a post that asked nothing and
 * waits on their nod alone, never does (the inbox store's own `ASKING`,
 * `packages/service/src/inbox/inbox-store.ts`).
 */
const findOpenQuestion = SqlSchema.findOneOption({
  Request: Schema.Struct({ taskId: Schema.String }),
  Result: TaskIdRowSchema,
  execute: ({ taskId }) =>
    Database.use((db) =>
      db
        .select({ id: inboxItem.id })
        .from(inboxItem)
        .where(
          and(
            eq(inboxItem.taskId, taskId),
            eq(inboxItem.status, INBOX_STATUS.OPEN),
            sql`${inboxItem.response} ->> 'type' <> ${INBOX_RESPONSE.NONE}`,
          ),
        )
        .limit(1),
    ),
});

/** The one write that settles a task done: the status, and when it was finished, under the lock the finish holds, on a task not settled already. */
const finishTask = SqlSchema.findOneOption({
  Request: Schema.Struct({ taskId: Schema.String, now: Schema.Date }),
  Result: TaskIdRowSchema,
  execute: ({ taskId, now }) =>
    Database.use((db) =>
      db
        .update(task)
        .set({ status: TASK_STATUS.DONE, completedAt: completedAtOf(TASK_STATUS.DONE, now) })
        .where(and(eq(task.id, taskId), notInArray(task.status, [...SETTLED])))
        .returning({ id: task.id }),
    ),
});

/**
 * Moves a task whose work is finished to done, and answers whether it moved.
 * The work is finished where every standing agent of the task, the archived
 * left out, stands idle by the caller's guard, none of them has a pull
 * request still open or a draft, at least one of them has a merged one, and
 * no inbox item of the task holds a question open for the developer. A task
 * already done or canceled, one the account does not reach, and one whose
 * work is not finished stand as they were, so asking at every moment that
 * may have finished it is safe: a turn's end, a pull request first seen
 * merged, an inbox question settled. Everything is read under the task's
 * row lock, each agent under its conversation's, as an archive reads them,
 * so a start or a turn racing the finish either landed before the read,
 * which then refuses, or waits on the lock and reopens the task after.
 * Like any change it is not a save, so the list's order stands.
 */
export function finishTaskWork<R = never>(
  userId: string,
  taskId: string,
  idle: TaskFinishGuard<R>,
): Effect.Effect<boolean, TaskStoreFailure, DatabaseServices | R> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockTask({ userId, taskId });
        if (Option.isNone(locked)) return false;
        if (SETTLED.includes(locked.value.status)) return false;
        const pullRequests = yield* findStandingPullRequestStates({ taskId });
        if (pullRequests.some(({ state }) => OPEN_PULL_REQUEST_STATES.includes(state)))
          return false;
        if (!pullRequests.some(({ state }) => state === PULL_REQUEST_STATE.MERGED)) return false;
        if (Option.isSome(yield* findOpenQuestion({ taskId }))) return false;
        const agents = yield* lockStandingAgents({ taskId });
        const standings = yield* Effect.forEach(agents, idle);
        if (standings.includes(false)) return false;
        const now = yield* DateTime.nowAsDate;
        const finished = yield* finishTask({ taskId, now });
        return Option.isSome(finished);
      }),
    ),
  );
}

/**
 * Deletes the task, its document, and its ended calls with what was said on
 * them, and stamps its coding agents' conversations cleared; false where the account reached no such task. The agents'
 * conversations are read before the delete, because the delete cascades
 * the agent rows that name them.
 *
 * A caller that stopped the task's agents first names the ones it stopped,
 * and the delete fails with `TaskAgentUnstopped` where any other stands. The
 * task's row is locked before the agents are read, so a Start racing the
 * delete either landed its agent before the read, which then refuses, or
 * waits on the lock and finds no task to start on. What the caller hands
 * `beforeDelete` runs under that lock once no other agent stands and before
 * anything goes, given each agent's conversation, so what it
 * does to them happens only to a task that is deleted.
 */
export function deleteTask<R = never>(
  userId: string,
  taskId: string,
  guard?: TaskDeleteGuard<R>,
): Effect.Effect<boolean, TaskStoreFailure | TaskAgentUnstopped, DatabaseServices | R> {
  return Effect.map(deleteTaskCommitted(userId, taskId, guard), Option.isSome);
}

/** A task deleted, as `deleteTask` deletes one, and the transaction its row went in; none where the account reached no such task. */
export function deleteTaskCommitted<R = never>(
  userId: string,
  taskId: string,
  guard?: TaskDeleteGuard<R>,
): Effect.Effect<
  Option.Option<{ readonly txid: string }>,
  TaskStoreFailure | TaskAgentUnstopped,
  DatabaseServices | R
> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockTask({ userId, taskId });
        if (Option.isNone(locked)) return Option.none();
        const agents = yield* findAgentConversations({ userId, taskId });
        if (guard !== undefined && agents.some(({ id }) => !guard.stoppedAgentIds.has(id))) {
          return yield* new TaskAgentUnstopped();
        }
        const conversationIds = agents.map((agent) => agent.conversationId);
        if (guard !== undefined) yield* guard.beforeDelete(conversationIds);
        const removed = yield* removeTask({ userId, taskId });
        if (Option.isNone(removed)) return Option.none();
        yield* removeEndedCalls({ userId, taskId });
        if (conversationIds.length > 0) {
          const now = yield* DateTime.nowAsDate;
          yield* stampConversations({ conversationIds, now });
        }
        return Option.some({ txid: removed.value.txid });
      }),
    ),
  );
}
