import { AUTOMATION_SCOPE } from "@luke/features/automation-wire";
import { CODING_AGENT_ARCHIVER } from "@luke/features/coding-agent-wire";
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
  type TaskPriority,
  type TaskStatus,
  type TaskSummary,
  taskPrioritySchema,
  taskStatusSchema,
  UNTITLED_TASK_NAME,
} from "@luke/features/task-wire";
import { and, desc, eq, exists, inArray, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import { Data, DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { attachment } from "../schemas/attachment.js";
import { organization } from "../schemas/auth.js";
import { automation } from "../schemas/automation.js";
import { codingAgent, type StoredArchive } from "../schemas/coding-agent.js";
import { inboxItem } from "../schemas/inbox.js";
import { issue } from "../schemas/issue.js";
import { personalWorkspace } from "../schemas/personal-workspace.js";
import { conversations } from "../schemas/storage.js";
import { task, taskNumberCounter } from "../schemas/task.js";
import { taskPin } from "../schemas/task-pin.js";
import { taskSectionEntry } from "../schemas/task-section.js";
import { voiceSessions } from "../schemas/voice.js";
import { CONVERSATION_KIND } from "../storage-vocabulary.js";
import { readPlanTemplate } from "./account-store.js";
import { followTaskArchive, moveTaskChat } from "./chat-store.js";
import { InstantColumnSchema } from "./columns.js";
import { stampSavedAttachments } from "./plan-attachments.js";
import { readLastEdit, readSectionWriters, UNKNOWN_AGENT_LABEL } from "./plan-revisions.js";
import { readTemplateAt } from "./plan-template-revisions.js";
import {
  linkTaskIssue,
  listTaskIssues,
  type NewTaskIssueLink,
  type TaskIssueLink,
} from "./task-issue-store.js";
import { reachableTask, readAccountNames, taskReachableBy } from "./workspace-store.js";

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
 * conversation is a `task` conversation of the member who opened it, opened
 * once and named on the row, and it goes with the task: deleting the task stamps it
 * `deleted_at`, and the conversations of the task's coding agents with it,
 * so the purge takes their words thirty days on. Every function is an effect over the ambient `SqlClient` and names
 * no database of its own.
 */

export type TaskStoreFailure = QueryError | Schema.SchemaError;

/** What a task store operation answers: an effect over the ambient client, composed into whatever called it. */
export type TaskStoreEffect<A> = Effect.Effect<A, TaskStoreFailure, DatabaseServices>;

/** The task is archived, so it takes the write asked of it only once it is brought back; nothing was written. */
export class TaskArchived extends Data.TaggedError("TaskArchived") {}

/** A coding agent stands on the task that its delete or its archive was not told was stopped: one started, or handed a message, while the others were stopped. */
export class TaskAgentUnstopped extends Data.TaggedError("TaskAgentUnstopped") {}

/** What a delete that stopped the task's agents first tells it. */
export interface TaskDeleteGuard<R> {
  /** The agents the caller stopped; any other standing refuses the delete. */
  readonly stoppedAgentIds: ReadonlySet<string>;
  /** Run under the task's lock before anything is deleted, given the task's conversation and each agent's. */
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
}

/**
 * What an archive of a plan whose agents the caller stopped first runs
 * under the plan's lock: whether each agent still stands stopped, read under
 * its conversation's lock, so one handed a message since refuses the archive.
 */
export type TaskArchiveGuard<R> = (
  agent: TaskArchivedAgent,
) => Effect.Effect<boolean, QueryError | Schema.SchemaError, R>;

/** One save a coding agent made, with the agent named as its row names it now. */
export interface LabelledAgentEdit extends PlanAgentEdit {
  readonly label: string;
}

/**
 * A task as the service holds it: what the window reads, its text, the saves
 * coding agents made with their notes, and the conversation it resumes in, if
 * one is attached.
 */
export interface StoredTask {
  readonly task: Task;
  /** The account that started the task, the one that may move it to another workspace. */
  readonly ownerId: string;
  /** The plan's whole text. */
  readonly text: string;
  readonly agentEdits: readonly LabelledAgentEdit[];
  readonly conversationId: string | undefined;
  /** Whether the text was ever saved since the task started: false while nobody has written it. */
  readonly saved: boolean;
  /** Who last changed each section, by heading, as its revisions read (`readSectionWriters`). */
  readonly sectionWriters: readonly PlanSectionWriter[];
  /** The external issues the task links, oldest linked first (`task-issue-store.ts`); none for a task that links none. */
  readonly issueLinks: readonly TaskIssueLink[];
  /** The developer's own words about the task as they started it; nothing for a task started with none. */
  readonly brief: string | undefined;
  /** The workspace's own issue the plan was started from, as it reads now; nothing for a plan started from none, or once it is gone. */
  readonly issue: StoredTaskIssue | undefined;
}

/**
 * The workspace's own issue a task was started from, as it reads now: its
 * number and what it says, and its workspace's name and slug, which its
 * identifier and its link are written from.
 */
export interface StoredTaskIssue {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly workspaceName: string;
  readonly workspaceSlug: string;
}

/**
 * A plan to start: the workspace it starts in, its name where one is given,
 * the repository it is about where one is chosen, the external issues it
 * links from the start, as the service read them, where any were picked, and
 * the workspace's own issue it starts from, where it was started from one, which
 * the caller confirms is an issue of the workspace it starts in. A plan started
 * with no name, or a blank one, stands as `UNTITLED_PLAN_NAME` until it is
 * renamed. A plan started with `planning` false skips its planning phase and
 * starts empty rather than as the template. A brief is the developer's own
 * words about the task, kept as written; a blank one is none.
 */
export interface NewTask {
  readonly organizationId: string;
  readonly name?: string;
  readonly repository?: string | null;
  readonly issueLinks?: readonly NewTaskIssueLink[];
  readonly issueId?: string;
  readonly planning?: boolean;
  readonly brief?: string;
  /** Where the task stands as it starts; to do where none is named. */
  readonly status?: TaskStatus;
  /** How much the task matters as it starts; unweighed where none is named. */
  readonly priority?: TaskPriority;
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
  readonly pinned?: boolean;
  /** Where the pin stands in the sidebar's Pinned section, which comes only with a pin. */
  readonly pinPosition?: string;
  readonly archived?: boolean;
  readonly status?: TaskStatus;
  readonly priority?: TaskPriority;
}

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
  repository: task.repository,
  issueId: task.issueId,
  archivedAt: task.archivedAt,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
};

/** The columns every other read and every `returning` projects, so a row decodes one way whatever wrote it. */
const TASK_COLUMNS = {
  ...TASK_SUMMARY_COLUMNS,
  agentEdits: task.agentEdits,
  document: task.document,
  conversationId: task.conversationId,
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
  repository: Schema.NullOr(Schema.String),
  issueId: Schema.NullOr(Schema.String),
  archivedAt: Schema.NullOr(InstantColumnSchema),
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
  conversationId: Schema.NullOr(Schema.String),
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
const insertPin = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String, now: Schema.Date }),
  execute: ({ userId, taskId, now }) =>
    Database.use((db) =>
      db.insert(taskPin).values({ userId, taskId, pinnedAt: now }).onConflictDoNothing(),
    ),
});

/** The reader's pin of the plan at the position given, from now where it was not pinned; one already standing keeps its instant and moves. */
const placePin = SqlSchema.void({
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
        .onConflictDoUpdate({ target: [taskPin.userId, taskPin.taskId], set: { position } }),
    ),
});

/** The reader's pin of the plan taken away; every other member's stands. */
const removePin = SqlSchema.void({
  Request: TaskKeySchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db.delete(taskPin).where(and(eq(taskPin.userId, userId), eq(taskPin.taskId, taskId))),
    ),
});

/** The agents the journal names, as their rows name them now; a row that is gone names nothing. */
const findAgentLabels = SqlSchema.findAll({
  Request: Schema.Struct({ taskId: Schema.String, agentIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({
    id: Schema.String,
    model: Schema.String,
    title: Schema.NullOr(Schema.String),
  }),
  execute: ({ taskId, agentIds }) =>
    Database.use((db) =>
      db
        .select({ id: codingAgent.id, model: codingAgent.model, title: codingAgent.title })
        .from(codingAgent)
        .where(and(eq(codingAgent.taskId, taskId), inArray(codingAgent.id, agentIds))),
    ),
});

/**
 * The agents the journal and the sections' writers name, by id, as their rows
 * name them now, so a renamed agent reads renamed everywhere: the label is
 * the row's title, or its model while it has none. The row's own account is
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
    (agents) => new Map(agents.map((agent) => [agent.id, agent.title ?? agent.model])),
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
    const summary = summaryOf(row, pin, yield* readAccountNames([row.userId]));
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
      text: row.document,
      agentEdits,
      conversationId: row.conversationId ?? undefined,
      saved: row.updatedAt.getTime() > row.createdAt.getTime(),
      sectionWriters,
      issueLinks: yield* listTaskIssues(userId, row.id),
      brief: row.brief ?? undefined,
      issue:
        row.issueId === null
          ? undefined
          : Option.getOrUndefined(
              yield* findTaskIssue({ issueId: row.issueId, organizationId: row.organizationId }),
            ),
    };
  });
}

/** The row's plan alone, as the reader reads it, for the writes that answer one. */
function taskOf(userId: string, row: TaskRow): TaskStoreEffect<Task> {
  return Effect.map(storedTaskOf(userId, row), (stored) => stored.task);
}

/**
 * The row as one line of the list, its owner named by `names`. Note that
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
    ...(pin === null ? undefined : { pinnedAt: pin.pinnedAt.getTime() }),
    ...(pin === null || pin.pinPosition === null ? undefined : { pinPosition: pin.pinPosition }),
    ...(row.archivedAt === null ? undefined : { archivedAt: row.archivedAt.getTime() }),
    ...(row.issueId === null ? undefined : { issueId: row.issueId }),
    status: row.status,
    priority: row.priority,
    number: row.number,
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
  repository: Schema.NullOr(Schema.String),
  document: Schema.String,
  issueId: Schema.NullOr(Schema.String),
  brief: Schema.NullOr(Schema.String),
  now: Schema.Date,
});

/** A task's row as an insert writes it. */
function taskValues(write: typeof TaskInsertSchema.Type) {
  return {
    ...(write.id === undefined ? undefined : { id: write.id }),
    userId: write.userId,
    organizationId: write.organizationId,
    name: write.name,
    number: write.number,
    status: write.status,
    priority: write.priority,
    repository: write.repository,
    document: write.document,
    issueId: write.issueId,
    brief: write.brief,
    createdAt: write.now,
    updatedAt: write.now,
  };
}

const insertTask = SqlSchema.findOne({
  Request: TaskInsertSchema,
  Result: TaskRowSchema,
  execute: (write) =>
    Database.use((db) => db.insert(task).values(taskValues(write)).returning(TASK_COLUMNS)),
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

/**
 * The issue a task names, where it is an issue of the task's own workspace,
 * with that workspace's name and slug; none where it is gone.
 */
const findTaskIssue = SqlSchema.findOneOption({
  Request: Schema.Struct({ issueId: Schema.String, organizationId: Schema.String }),
  Result: Schema.Struct({
    id: Schema.String,
    number: Schema.Number,
    title: Schema.String,
    description: Schema.String,
    workspaceName: Schema.String,
    workspaceSlug: Schema.String,
  }),
  execute: ({ issueId, organizationId }) =>
    Database.use((db) =>
      db
        .select({
          id: issue.id,
          number: issue.number,
          title: issue.title,
          description: issue.description,
          workspaceName: organization.name,
          workspaceSlug: organization.slug,
        })
        .from(issue)
        .innerJoin(organization, eq(organization.id, issue.organizationId))
        .where(and(eq(issue.id, issueId), eq(issue.organizationId, organizationId)))
        .limit(1),
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
  issueId: Schema.optionalKey(Schema.Null),
  number: Schema.optionalKey(Schema.Number),
  status: Schema.optionalKey(taskStatusSchema),
  priority: Schema.optionalKey(taskPrioritySchema),
  archivedAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
});

type TaskColumnChanges = typeof TaskColumnChangesSchema.Type;

/** The row changed: whichever of the name, the workspace and its number there, the repository, the status, the priority, and the archive the change names, in one statement. */
const applyChanges = SqlSchema.findOne({
  Request: Schema.Struct({
    userId: Schema.String,
    taskId: Schema.String,
    ...TaskColumnChangesSchema.fields,
  }),
  Result: TaskRowSchema,
  execute: ({ userId, taskId, ...changes }) =>
    Database.use((db) =>
      db.update(task).set(changes).where(reachableTask(userId, taskId)).returning(TASK_COLUMNS),
    ),
});

const findTaskOfConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: TaskRowSchema,
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select(TASK_COLUMNS)
        .from(task)
        .where(and(taskReachableBy(userId), eq(task.conversationId, conversationId)))
        .limit(1),
    ),
});

const TaskConversationRowSchema = Schema.Struct({
  conversationId: Schema.NullOr(Schema.String),
  conversationOwnerId: Schema.NullOr(Schema.String),
  conversationDeletedAt: Schema.NullOr(InstantColumnSchema),
});

/** The task row under its own lock, with the conversation it names, the member who opened it, and whether it still stands. */
const lockTaskConversation = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: TaskConversationRowSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({
          conversationId: task.conversationId,
          conversationOwnerId: conversations.userId,
          conversationDeletedAt: conversations.deletedAt,
        })
        .from(task)
        .leftJoin(conversations, eq(conversations.id, task.conversationId))
        .where(reachableTask(userId, taskId))
        .for("update", { of: task }),
    ),
});

const insertTaskConversation = SqlSchema.findOne({
  Request: Schema.Struct({ userId: Schema.String, now: Schema.Date }),
  Result: TaskIdRowSchema,
  execute: ({ userId, now }) =>
    Database.use((db) =>
      db
        .insert(conversations)
        .values({ userId, kind: CONVERSATION_KIND.TASK, createdAt: now, lastActivityAt: now })
        .returning({ id: conversations.id }),
    ),
});

const removeTask = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: Schema.Struct({ conversationId: Schema.NullOr(Schema.String) }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .delete(task)
        .where(reachableTask(userId, taskId))
        .returning({ conversationId: task.conversationId }),
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
 * Only a standing conversation of the same account may be attached, so the
 * association can name nothing the task's owner could not read themselves.
 */
const setConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    taskId: Schema.String,
    conversationId: Schema.String,
  }),
  Result: TaskIdRowSchema,
  execute: ({ userId, taskId, conversationId }) =>
    Database.use((db) =>
      db
        .update(task)
        .set({ conversationId })
        .where(
          and(
            reachableTask(userId, taskId),
            exists(
              db
                .select({ id: conversations.id })
                .from(conversations)
                .where(
                  and(
                    eq(conversations.id, conversationId),
                    eq(conversations.userId, userId),
                    isNull(conversations.deletedAt),
                  ),
                ),
            ),
          ),
        )
        .returning({ id: task.id }),
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
      document: template ?? DEFAULT_PLAN_TEMPLATE,
      issueId: started.issueId ?? null,
      brief: brief.length > 0 ? brief : null,
      status: started.status ?? TASK_STATUS.TODO,
      priority: started.priority ?? TASK_PRIORITY.NONE,
      number: yield* nextTaskNumber(started.organizationId),
      now,
    };
  });

export function createTask(userId: string, started: NewTask): TaskStoreEffect<Task> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const row = yield* insertTask(yield* insertOf(userId, started)).pipe(
          // An insert that returned no row is the database breaking its own contract, not an outcome.
          Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
        );
        for (const link of started.issueLinks ?? []) {
          yield* linkTaskIssue(userId, row.id, link).pipe(
            // A new task's links are its starter's few, each named once, so a refusal is the caller breaking its contract.
            Effect.catchTags({ TaskIssuesFull: Effect.die, TaskIssueLinked: Effect.die }),
          );
        }
        return yield* taskOf(userId, row);
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
): TaskStoreEffect<Option.Option<Task>> {
  return Effect.gen(function* () {
    const values = yield* insertOf(userId, { ...started, planning: false });
    const row = yield* insertTaskOnce({ ...values, document: started.text });
    return yield* Effect.transposeOption(Option.map(row, (made) => taskOf(userId, made)));
  });
}

/**
 * Every task of every workspace the account is a member of, newest started first, without their documents,
 * and without the archived ones unless `includeArchived` asks for them.
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
    const names = yield* readAccountNames(rows.map((row) => row.userId));
    return rows.map((row) =>
      summaryOf(
        row,
        row.pinnedAt === null ? null : { pinnedAt: row.pinnedAt, pinPosition: row.pinPosition },
        names,
      ),
    );
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
 * next number of the workspace it moves to.
 */
function columnChangesOf(
  changes: TaskChanges,
  standing: TaskRow,
  now: Date,
  movedNumber: number | undefined,
): TaskColumnChanges {
  return {
    ...(changes.name === undefined ? undefined : { name: changes.name }),
    // An issue is its workspace's, so a task moved to another lets its issue go.
    ...(movedNumber === undefined || changes.organizationId === undefined
      ? undefined
      : { organizationId: changes.organizationId, issueId: null, number: movedNumber }),
    ...(changes.repository === undefined ? undefined : { repository: changes.repository }),
    ...(changes.status === undefined ? undefined : { status: changes.status }),
    ...(changes.priority === undefined ? undefined : { priority: changes.priority }),
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
): TaskStoreEffect<void> {
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
  }),
  execute: ({ taskId }) =>
    Database.use((db) =>
      db
        .select({
          id: codingAgent.id,
          conversationId: codingAgent.conversationId,
          createdAt: codingAgent.createdAt,
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
  TaskStoreFailure | TaskArchived | TaskAgentUnstopped | E,
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
          changes.priority !== undefined;
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
        if (changes.pinned !== undefined) {
          yield* pinAsAsked(userId, taskId, changes.pinned, changes.pinPosition, now);
        }
        const moved =
          changes.organizationId !== undefined &&
          changes.organizationId !== locked.value.organizationId;
        // A task moved to another workspace takes the next number there; its old one is never handed out again.
        const movedNumber = moved ? yield* nextTaskNumber(changes.organizationId) : undefined;
        const columns = columnChangesOf(changes, locked.value, now, movedNumber);
        // A change that names only a pin writes nothing of the row, and an update with nothing to set is no statement.
        const row =
          Object.keys(columns).length === 0
            ? locked.value
            : yield* applyChanges({ userId, taskId, ...columns }).pipe(
                // The row is held under this transaction's lock, so an update that missed it is the database breaking its own contract.
                Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
              );
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
        return Option.some(yield* taskOf(userId, row));
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

/** The statuses work on a task has not yet begun in, which an agent started on it moves it out of. */
const NOT_BEGUN: readonly TaskStatus[] = [TASK_STATUS.BACKLOG, TASK_STATUS.TODO];

const beginTask = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: TaskIdRowSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .update(task)
        .set({ status: TASK_STATUS.IN_PROGRESS })
        .where(and(reachableTask(userId, taskId), inArray(task.status, [...NOT_BEGUN])))
        .returning({ id: task.id }),
    ),
});

/**
 * Moves a task whose work has not begun, in the backlog or to do, to in
 * progress, as a coding agent started on it does, and answers whether it
 * moved. A task already in progress, done, or canceled, and one the account
 * does not reach, stand as they were, so asking again moves nothing and
 * nothing ever moves a task back. Like any change it is not a save, so the
 * list's order stands; the check and the write are one statement.
 */
export function beginTaskWork(userId: string, taskId: string): TaskStoreEffect<boolean> {
  return Effect.map(beginTask({ userId, taskId }), Option.isSome);
}

/**
 * Deletes the task, its document, and its ended calls with what was said on
 * them, and stamps its conversation and its coding agents' conversations
 * cleared; false where the account reached no such task. The agents'
 * conversations are read before the delete, because the delete cascades
 * the agent rows that name them.
 *
 * A caller that stopped the task's agents first names the ones it stopped,
 * and the delete fails with `TaskAgentUnstopped` where any other stands. The
 * task's row is locked before the agents are read, so a Start racing the
 * delete either landed its agent before the read, which then refuses, or
 * waits on the lock and finds no task to start on. What the caller hands
 * `beforeDelete` runs under that lock once no other agent stands and before
 * anything goes, given the task's conversation and each agent's, so what it
 * does to them happens only to a task that is deleted.
 */
export function deleteTask<R = never>(
  userId: string,
  taskId: string,
  guard?: TaskDeleteGuard<R>,
): Effect.Effect<boolean, TaskStoreFailure | TaskAgentUnstopped, DatabaseServices | R> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockTask({ userId, taskId });
        if (Option.isNone(locked)) return false;
        const agents = yield* findAgentConversations({ userId, taskId });
        if (guard !== undefined && agents.some(({ id }) => !guard.stoppedAgentIds.has(id))) {
          return yield* new TaskAgentUnstopped();
        }
        const { conversationId } = locked.value;
        const conversationIds = [
          ...(conversationId === null ? [] : [conversationId]),
          ...agents.map((agent) => agent.conversationId),
        ];
        if (guard !== undefined) yield* guard.beforeDelete(conversationIds);
        const removed = yield* removeTask({ userId, taskId });
        if (Option.isNone(removed)) return false;
        yield* removeEndedCalls({ userId, taskId });
        if (conversationIds.length > 0) {
          const now = yield* DateTime.nowAsDate;
          yield* stampConversations({ conversationIds, now });
        }
        return true;
      }),
    ),
  );
}

/**
 * Names the conversation the task resumes in. False, and nothing written,
 * where the account reaches no such task or no such standing conversation.
 */
export function attachTaskConversation(
  userId: string,
  taskId: string,
  conversationId: string,
): TaskStoreEffect<boolean> {
  return Effect.map(setConversation({ userId, taskId, conversationId }), Option.isSome);
}

/** A task's conversation as the store addresses it: its id and the member who opened it, whose id its rows are written under. */
export interface TaskConversation {
  readonly conversationId: string;
  readonly ownerId: string;
}

/**
 * The conversation the task's brain runs in, opened and attached
 * now where the task names none that still stands; nothing where the account
 * reaches no such task. A conversation a teammate opened is answered as
 * theirs, so the caller speaks into the task's one conversation rather than
 * opening a second; one opened here is the caller's own. The task row's
 * lock holds two opens of one task one after the other, so the second finds
 * the first's conversation rather than opening another.
 */
export function openTaskConversation(
  userId: string,
  taskId: string,
): TaskStoreEffect<Option.Option<TaskConversation>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockTaskConversation({ userId, taskId });
        if (Option.isNone(locked)) return Option.none();
        const { conversationId, conversationOwnerId, conversationDeletedAt } = locked.value;
        if (
          conversationId !== null &&
          conversationOwnerId !== null &&
          conversationDeletedAt === null
        ) {
          return Option.some({ conversationId, ownerId: conversationOwnerId });
        }
        const now = yield* DateTime.nowAsDate;
        const opened = yield* insertTaskConversation({ userId, now }).pipe(
          // An insert that returned no row is the database breaking its own contract, not an outcome.
          Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
        );
        if (!(yield* attachTaskConversation(userId, taskId, opened.id))) {
          return yield* Effect.die(new Error("the task's new conversation did not attach"));
        }
        return Option.some({ conversationId: opened.id, ownerId: userId });
      }),
    ),
  );
}

/**
 * The task a conversation belongs to, with its saved document; nothing for a
 * conversation no task the account reaches names. This is how a
 * brain turn, admitted for a conversation, finds the document it is handed
 * and the task whose repository its reads are bound to.
 */
export function readTaskOfConversation(
  userId: string,
  conversationId: string,
): TaskStoreEffect<Option.Option<StoredTask>> {
  return Effect.flatMap(findTaskOfConversation({ userId, conversationId }), (found) =>
    Effect.transposeOption(Option.map(found, (row) => storedTaskOf(userId, row))),
  );
}
