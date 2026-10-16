import { AUTOMATION_SCOPE } from "@luke/features/automation-wire";
import { type TaskLinearIssue, taskLinearIssueSchema } from "@luke/features/linear-wire";
import { planAttachmentIdsIn } from "@luke/features/plan-attachment-link";
import type { PlanSectionWriter } from "@luke/features/plan-document";
import { DEFAULT_PLAN_TEMPLATE } from "@luke/features/plan-document-template";
import { type PlanAgentEdit, planAgentEditSchema } from "@luke/features/plan-template";
import {
  PLAN_ACTOR,
  type PlanLastEdit,
  type PlanSectionEdit,
  type Task,
  type TaskSummary,
  UNTITLED_TASK_NAME,
} from "@luke/features/task-wire";
import { and, desc, eq, exists, inArray, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import { Data, DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { automation } from "../schemas/automation.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { inboxItem } from "../schemas/inbox.js";
import { inboxAttachment } from "../schemas/inbox-attachment.js";
import { personalWorkspace } from "../schemas/personal-workspace.js";
import { task } from "../schemas/plan.js";
import { taskPin } from "../schemas/plan-pin.js";
import { conversations } from "../schemas/storage.js";
import { voiceSessions } from "../schemas/voice.js";
import { CONVERSATION_KIND } from "../storage-vocabulary.js";
import { readPlanTemplate } from "./account-store.js";
import { InstantColumnSchema } from "./columns.js";
import { stampSavedAttachments } from "./plan-attachments.js";
import { readLastEdit, readSectionWriters, UNKNOWN_AGENT_LABEL } from "./plan-revisions.js";
import { readTemplateAt } from "./plan-template-revisions.js";
import { reachableTask, readAccountNames, taskReachableBy } from "./workspace-store.js";

/**
 * task-store.ts -- the named plans of an account's workspaces, and the one document each holds.
 *
 * A plan is read and written by every member of the workspace it names,
 * whichever of them started it. Every statement here names the account it
 * runs for beside the plan and gates on that account's membership
 * (`workspace-store.ts`), so a plan of a workspace the account is not in
 * reads, saves, changes, and deletes exactly as an id that names nothing: as
 * no plan. An archive is a stamp on the row, so it is the workspace's and
 * reads alike for every member on every Mac; a pin is the reading member's
 * own (`plan-pin.ts`), so a plan of a shared workspace one member pinned
 * reads pinned for them alone, on every Mac they sign in on. A plan's repository is kept here as
 * handed and confirmed nowhere here: whether the account reaches it through
 * the Luke GitHub App is the route's to settle before it calls, on the
 * service that reads GitHub (`github/github-app.ts`), and so is whether the
 * account is a member of the workspace a plan starts in. A save is one `update` over the row that
 * stands and never an insert, so a plan deleted before a save lands stays
 * deleted, and a save that fails leaves the document as it was. A plan's
 * conversation is a `task` conversation of the member who opened it, opened
 * once and named on the row, and it goes with the plan: deleting the plan stamps it
 * `deleted_at`, and the conversations of the plan's coding agents with it,
 * so the purge takes their words thirty days on. Every function is an effect over the ambient `SqlClient` and names
 * no database of its own.
 */

export type TaskStoreFailure = QueryError | Schema.SchemaError;

/** What a plan store operation answers: an effect over the ambient client, composed into whatever called it. */
export type TaskStoreEffect<A> = Effect.Effect<A, TaskStoreFailure, DatabaseServices>;

/** The plan is archived, so it takes the write asked of it only once it is brought back; nothing was written. */
export class TaskArchived extends Data.TaggedError("TaskArchived") {}

/** A coding agent stands on the plan that its delete was not told was stopped: one started while the delete stopped the others. */
export class TaskAgentUnstopped extends Data.TaggedError("TaskAgentUnstopped") {}

/** What a delete that stopped the plan's agents first tells it. */
export interface TaskDeleteGuard<R> {
  /** The agents the caller stopped; any other standing refuses the delete. */
  readonly stoppedAgentIds: ReadonlySet<string>;
  /** Run under the plan's lock before anything is deleted, given the plan's conversation and each agent's. */
  readonly beforeDelete: (
    conversationIds: readonly string[],
  ) => Effect.Effect<void, QueryError | Schema.SchemaError, R>;
}

/**
 * What a change that moves a plan runs first: given the repository the row
 * names under its lock, the caller's confirmation that the workspace it moves
 * to reaches it, so a repository changed while the move was asked cannot
 * ride into a workspace that does not reach it. Its failure leaves the plan
 * unchanged.
 */
export type TaskMoveGuard<E, R> = (repository: string | null) => Effect.Effect<void, E, R>;

/** One save a coding agent made, with the agent named as its row names it now. */
export interface LabelledAgentEdit extends PlanAgentEdit {
  readonly label: string;
}

/**
 * A plan as the service holds it: what the window reads, its text, the saves
 * coding agents made with their notes, and the conversation it resumes in, if
 * one is attached.
 */
export interface StoredTask {
  readonly task: Task;
  /** The account that started the plan, the one that may move it to another workspace. */
  readonly ownerId: string;
  /** The plan's whole text. */
  readonly text: string;
  readonly agentEdits: readonly LabelledAgentEdit[];
  readonly conversationId: string | undefined;
  /** Whether the text was ever saved since the plan started: false while nobody has written it. */
  readonly saved: boolean;
  /** Who last changed each section, by heading, as its revisions read (`readSectionWriters`). */
  readonly sectionWriters: readonly PlanSectionWriter[];
  /** The Linear issue the plan was started from, as it was read then; nothing for a plan started from none. */
  readonly linearIssue: TaskLinearIssue | undefined;
}

/**
 * A plan to start: the workspace it starts in, its name where one is given,
 * the repository it is about where one is chosen, and the Linear issue it
 * starts from, as the service read it, where one was picked. A plan started
 * with no name, or a blank one, stands as `UNTITLED_PLAN_NAME` until it is
 * renamed. A plan started with `planning` false skips its planning phase and
 * starts empty rather than as the template.
 */
export interface NewTask {
  readonly organizationId: string;
  readonly name?: string;
  readonly repository?: string | null;
  readonly linearIssue?: TaskLinearIssue;
  readonly planning?: boolean;
}

/**
 * What a change to a plan names: a new name, a repository or null to clear
 * it, pinned or not, archived or not, the workspace it moves to, or any of
 * them at once. A move is its owner's alone, into a workspace they are a
 * member of, which the caller confirms first.
 */
export interface TaskChanges {
  readonly name?: string;
  readonly organizationId?: string;
  readonly repository?: string | null;
  readonly pinned?: boolean;
  readonly archived?: boolean;
}

/**
 * The columns a line of the list reads: none of the document. Note that the
 * list projects these alone, because a migration that reshapes the document
 * lands before the build that reads the new shape is live, and a list that
 * decoded the document would then refuse every plan rather than just the one
 * opened.
 */
const TASK_SUMMARY_COLUMNS = {
  id: task.id,
  userId: task.userId,
  organizationId: task.organizationId,
  name: task.name,
  repository: task.repository,
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
  linearIssue: task.linearIssue,
};

const TaskSummaryRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  organizationId: Schema.String,
  name: Schema.String,
  repository: Schema.NullOr(Schema.String),
  archivedAt: Schema.NullOr(InstantColumnSchema),
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

type TaskSummaryRow = typeof TaskSummaryRowSchema.Type;

/** A line of the list with the reader's own pin beside it; null where they hold none. */
const TaskListRowSchema = Schema.Struct({
  ...TaskSummaryRowSchema.fields,
  pinnedAt: Schema.NullOr(InstantColumnSchema),
});

const TaskRowSchema = Schema.Struct({
  ...TaskSummaryRowSchema.fields,
  agentEdits: Schema.Array(planAgentEditSchema),
  // Every plan is one document since the backfill, so a row with none is the store breaking its own contract.
  document: Schema.String,
  conversationId: Schema.NullOr(Schema.String),
  linearIssue: Schema.NullOr(taskLinearIssueSchema),
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
  Result: Schema.Struct({ pinnedAt: InstantColumnSchema }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({ pinnedAt: taskPin.pinnedAt })
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
 * history begins, the newest save a coding agent made. A plan is saved once
 * a save has moved its last save past its start, which no creation and no
 * carrying over does.
 */
function storedTaskOf(userId: string, row: TaskRow): TaskStoreEffect<StoredTask> {
  return Effect.gen(function* () {
    const pin = yield* findPin({ userId, taskId: row.id });
    const pinnedAt = Option.match(pin, { onNone: () => null, onSome: (held) => held.pinnedAt });
    const summary = summaryOf(row, pinnedAt, yield* readAccountNames([row.userId]));
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
      linearIssue: row.linearIssue ?? undefined,
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
 * the reader's own `pinnedAt`, and an archive are answered only where they
 * stand, so a plan that is neither reads as every plan did before them; an
 * owner whose account is gone is named by nothing.
 */
function summaryOf(
  row: TaskSummaryRow,
  pinnedAt: Date | null,
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
    ...(pinnedAt === null ? undefined : { pinnedAt: pinnedAt.getTime() }),
    ...(row.archivedAt === null ? undefined : { archivedAt: row.archivedAt.getTime() }),
  };
}

const insertTask = SqlSchema.findOne({
  Request: Schema.Struct({
    userId: Schema.String,
    organizationId: Schema.String,
    name: Schema.String,
    repository: Schema.NullOr(Schema.String),
    document: Schema.String,
    linearIssue: Schema.NullOr(taskLinearIssueSchema),
    now: Schema.Date,
  }),
  Result: TaskRowSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(task)
        .values({
          userId: write.userId,
          organizationId: write.organizationId,
          name: write.name,
          repository: write.repository,
          document: write.document,
          linearIssue: write.linearIssue,
          createdAt: write.now,
          updatedAt: write.now,
        })
        .returning(TASK_COLUMNS),
    ),
});

const findTasks = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, includeArchived: Schema.Boolean }),
  Result: TaskListRowSchema,
  execute: ({ userId, includeArchived }) =>
    Database.use((db) =>
      db
        .select({ ...TASK_SUMMARY_COLUMNS, pinnedAt: taskPin.pinnedAt })
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

/** The plan row under its own lock, so a change and a save of the same plan run one after the other. */
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
  archivedAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
});

type TaskColumnChanges = typeof TaskColumnChangesSchema.Type;

/** The row changed: whichever of the name, the workspace, the repository, and the archive the change names, in one statement. */
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

/** The plan row under its own lock, with the conversation it names, the member who opened it, and whether it still stands. */
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
 * The plan's calls that have ended, and with them the words said on each,
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

/** The conversations of the plan's coding agents, read before the delete cascades the rows that name them. */
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
 * association can name nothing the plan's owner could not read themselves.
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
 * Starts a plan under the account, in the workspace it was handed, as one
 * document, a copy of the account's own template or the default where it
 * keeps none, or empty where it skips its planning phase, with the
 * repository it was handed; it stands first in the list. A plan handed no
 * name, or a blank one, starts as
 * `UNTITLED_PLAN_NAME`. Note that the template is copied, not referred to,
 * because an edit of the template must leave every plan started from it as
 * it stands.
 */
export function createTask(userId: string, started: NewTask): TaskStoreEffect<Task> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const template = started.planning === false ? "" : yield* readPlanTemplate(userId);
    const named = started.name?.trim() ?? "";
    const row = yield* insertTask({
      userId,
      organizationId: started.organizationId,
      name: named.length > 0 ? named : UNTITLED_TASK_NAME,
      repository: started.repository ?? null,
      document: template ?? DEFAULT_PLAN_TEMPLATE,
      linearIssue: started.linearIssue ?? null,
      now,
    }).pipe(
      // An insert that returned no row is the database breaking its own contract, not an outcome.
      Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
    );
    return yield* taskOf(userId, row);
  });
}

/**
 * Every plan of every workspace the account is a member of, newest started first, without their documents,
 * and without the archived ones unless `includeArchived` asks for them.
 * Nothing but starting a plan moves the order: opening, reading, saving,
 * pinning, and archiving one leave every row where it stood, and the order a
 * pin draws is the window's to draw from `pinnedAt`.
 */
export function listTasks(
  userId: string,
  options: { readonly includeArchived?: boolean } = {},
): TaskStoreEffect<readonly TaskSummary[]> {
  return Effect.gen(function* () {
    const rows = yield* findTasks({ userId, includeArchived: options.includeArchived === true });
    const names = yield* readAccountNames(rows.map((row) => row.userId));
    return rows.map((row) => summaryOf(row, row.pinnedAt, names));
  });
}

/**
 * The plan with its saved document and its conversation, or nothing for a
 * plan of a workspace the account is not in. This is the read the window opens a plan
 * through and the planning model starts and resumes from.
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
 * The plan as `readTask` reads it, held under the row's lock until the
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
 * Replaces the text of a plan that is one document, with the agents' journal
 * where it is handed, stamps the plan's pictures the text names as saved, and answers
 * the plan as saved, or nothing where the account reaches no such plan; nothing
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

/** The columns of the row the change names, its archive stamped from the one standing; none where it names only a pin. */
function columnChangesOf(changes: TaskChanges, standing: TaskRow, now: Date): TaskColumnChanges {
  return {
    ...(changes.name === undefined ? undefined : { name: changes.name }),
    ...(changes.organizationId === undefined
      ? undefined
      : { organizationId: changes.organizationId }),
    ...(changes.repository === undefined ? undefined : { repository: changes.repository }),
    ...(changes.archived === undefined
      ? undefined
      : { archivedAt: stampOf(changes.archived, standing.archivedAt, now) }),
  };
}

/**
 * The reader's own pin of the plan set as asked: from now, or from the
 * instant already standing, as an archive's stamp is; or taken away. Every
 * other member's pin stands as it was.
 */
function pinAsAsked(
  userId: string,
  taskId: string,
  pinned: boolean,
  now: Date,
): TaskStoreEffect<void> {
  return pinned ? insertPin({ userId, taskId, now }) : removePin({ userId, taskId });
}

/**
 * The plan's automations moved along with it: their workspace and their
 * repository follow the plan's, so a plan moved to another workspace, or
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
 * The plan's agents and inbox moved along with it to another workspace, so
 * no row of the plan's stays tied to the workspace it left, whose deletion
 * would otherwise take them with it.
 */
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
    db.update(inboxAttachment).set({ organizationId }).where(eq(inboxAttachment.taskId, taskId)),
  );
});

/**
 * Changes the plan, a new name with its document's heading, a repository or
 * none, pinned or not, archived or not, its workspace, and answers it as
 * changed, or nothing where the account reaches no such plan. The changes
 * arrive already read under the wire's rules, and a repository already
 * confirmed reachable; a move runs the caller's guard under the row's lock
 * on the repository the plan will name once it lands. A change is
 * not a save: the document's `updatedAt` and the list's order stand. The pin
 * is the account's own and no other member's, and a pin
 * and an archive are kept apart, so a pinned plan archived and brought back
 * is pinned again. An archived plan is neither renamed nor given another
 * repository, read under the same lock, unless the same change brings it
 * back; its pin and its archive still change.
 */
export function updateTask<E = never, R = never>(
  userId: string,
  taskId: string,
  changes: TaskChanges,
  moveGuard?: TaskMoveGuard<E, R>,
): Effect.Effect<Option.Option<Task>, TaskStoreFailure | TaskArchived | E, DatabaseServices | R> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockTask({ userId, taskId });
        if (Option.isNone(locked)) return Option.none();
        const stillArchived = locked.value.archivedAt !== null && changes.archived !== false;
        const reworded =
          changes.name !== undefined ||
          changes.repository !== undefined ||
          changes.organizationId !== undefined;
        if (stillArchived && reworded) return yield* new TaskArchived();
        if (changes.organizationId !== undefined && moveGuard !== undefined) {
          yield* moveGuard(
            changes.repository === undefined ? locked.value.repository : changes.repository,
          );
        }
        const now = yield* DateTime.nowAsDate;
        if (changes.pinned !== undefined) yield* pinAsAsked(userId, taskId, changes.pinned, now);
        const columns = columnChangesOf(changes, locked.value, now);
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
        }
        return Option.some(yield* taskOf(userId, row));
      }),
    ),
  );
}

/**
 * Deletes the plan, its document, and its ended calls with what was said on
 * them, and stamps its conversation and its coding agents' conversations
 * cleared; false where the account reached no such plan. The agents'
 * conversations are read before the delete, because the delete cascades
 * the agent rows that name them.
 *
 * A caller that stopped the plan's agents first names the ones it stopped,
 * and the delete fails with `PlanAgentUnstopped` where any other stands. The
 * plan's row is locked before the agents are read, so a Start racing the
 * delete either landed its agent before the read, which then refuses, or
 * waits on the lock and finds no plan to start on. What the caller hands
 * `beforeDelete` runs under that lock once no other agent stands and before
 * anything goes, given the plan's conversation and each agent's, so what it
 * does to them happens only to a plan that is deleted.
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
 * Names the conversation the plan resumes in. False, and nothing written,
 * where the account reaches no such plan or no such standing conversation.
 */
export function attachTaskConversation(
  userId: string,
  taskId: string,
  conversationId: string,
): TaskStoreEffect<boolean> {
  return Effect.map(setConversation({ userId, taskId, conversationId }), Option.isSome);
}

/** A plan's conversation as the store addresses it: its id and the member who opened it, whose id its rows are written under. */
export interface TaskConversation {
  readonly conversationId: string;
  readonly ownerId: string;
}

/**
 * The conversation the plan's planning model runs in, opened and attached
 * now where the plan names none that still stands; nothing where the account
 * reaches no such plan. A conversation a teammate opened is answered as
 * theirs, so the caller speaks into the plan's one conversation rather than
 * opening a second; one opened here is the caller's own. The plan row's
 * lock holds two opens of one plan one after the other, so the second finds
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
          return yield* Effect.die(new Error("the plan's new conversation did not attach"));
        }
        return Option.some({ conversationId: opened.id, ownerId: userId });
      }),
    ),
  );
}

/**
 * The plan a conversation belongs to, with its saved document; nothing for a
 * conversation no plan the account reaches names. This is how a
 * planning turn, admitted for a conversation, finds the document it is handed
 * and the plan whose repository its reads are bound to.
 */
export function readTaskOfConversation(
  userId: string,
  conversationId: string,
): TaskStoreEffect<Option.Option<StoredTask>> {
  return Effect.flatMap(findTaskOfConversation({ userId, conversationId }), (found) =>
    Effect.transposeOption(Option.map(found, (row) => storedTaskOf(userId, row))),
  );
}
