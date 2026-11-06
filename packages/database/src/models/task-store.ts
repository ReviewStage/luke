import {
  AGENT_KIND,
  AGENT_MACHINE,
  type AgentMachineKind,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import { DEVICE_KIND } from "@repo/features/device-agent-wire";
import { GITHUB_ACCESS, type GitHubAccess } from "@repo/features/github-repositories-wire";
import { INBOX_STATUS } from "@repo/features/inbox-wire";
import { agentName } from "@repo/features/model-label";
import { descriptionAttachmentIdsIn } from "@repo/features/description-attachment-link";
import type { DescriptionSectionWriter } from "@repo/features/description-document";
import {
  type DescriptionAgentEdit,
  descriptionAgentEditSchema,
} from "@repo/features/description-notes";
import { READ_MARK, type ReadMark } from "@repo/features/read-mark";
import {
  DESCRIPTION_ACTOR,
  type DescriptionLastEdit,
  type DescriptionSectionEdit,
  TASK_MODE,
  TASK_PRIORITY,
  TASK_STATUS,
  type Task,
  type TaskMode,
  type TaskOrigin,
  type TaskPriority,
  type TaskRunsOn,
  type TaskStatus,
  type TaskSummary,
  taskModeSchema,
  taskPrioritySchema,
  taskStatusSchema,
  UNKNOWN_AGENT_LABEL,
  UNTITLED_TASK_NAME,
} from "@repo/features/task-wire";
import {
  and,
  desc,
  eq,
  gte,
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
import {
  Database,
  type DatabaseServices,
  type QueryError,
  queryBuilder,
  readConcurrency,
  type StoreFailure,
} from "../core/query.js";
import { agentTable, type StoredArchive } from "../schemas/agent.js";
import { agentRepository } from "../schemas/agent-repository.js";
import { attachment } from "../schemas/attachment.js";
import { inboxItem } from "../schemas/inbox.js";
import { conversations } from "../schemas/storage.js";
import { task, taskNumberCounter } from "../schemas/task.js";
import { taskPin } from "../schemas/task-pin.js";
import { taskRead } from "../schemas/task-read.js";
import { taskSectionEntry } from "../schemas/task-section.js";
import { agentAutomationNameSql } from "./agent-name.js";
import { ArchivedByColumnSchema, InstantColumnSchema } from "./columns.js";
import { type Device, devicesNamed } from "./device-store.js";
import {
  reopenAgentInboxItems,
  reopenTaskInboxItems,
  settleAgentInboxItems,
  settleTaskInboxItems,
} from "./inbox-settle.js";
import { stampSavedAttachments } from "./description-attachments.js";
import { readLastEdit, readSectionWriters } from "./description-revisions.js";
import { taskMadeByRun } from "./run-tasks.js";
import { stampConversationsDeleted } from "./soft-delete.js";
import {
  leaveTaskBlocks,
  lockTasksForBlocks,
  readTaskBlocks,
  taskBlockedFor,
} from "./task-block-store.js";
import { forwardTaskNumber } from "./task-number-store.js";
import {
  isWorkspaceMember,
  reachableTask,
  readAccountNames,
  taskReachableBy,
} from "./workspace-store.js";

export type TaskStoreFailure = StoreFailure;

export type TaskStoreEffect<A> = Effect.Effect<A, TaskStoreFailure, DatabaseServices>;

export class TaskAssigneeNotMember extends Data.TaggedError("TaskAssigneeNotMember") {}

export class TaskTreeRepositoryLocked extends Data.TaggedError("TaskTreeRepositoryLocked") {}

export class TaskParentUnreached extends Data.TaggedError("TaskParentUnreached") {}

export class TaskParentRepositoryDiffers extends Data.TaggedError("TaskParentRepositoryDiffers")<{
  readonly repository: string | null;
}> {}

export class TaskParentCycle extends Data.TaggedError("TaskParentCycle") {}

export class TaskIdTaken extends Data.TaggedError("TaskIdTaken") {}

export class TaskAgentUnstopped extends Data.TaggedError("TaskAgentUnstopped") {}

export interface TaskDeleteGuard {
  readonly stoppedAgentIds: ReadonlySet<string>;
}

export type TaskMoveGuard<E, R> = (repository: string | null) => Effect.Effect<void, E, R>;

export interface TaskStandingAgent {
  readonly id: string;
  readonly conversationId: string;
  readonly createdAt: Date;
  readonly blank: boolean;
}

export type TaskFinishGuard<R> = (
  agents: readonly TaskStandingAgent[],
) => Effect.Effect<boolean, QueryError | Schema.SchemaError, R>;

type TaskIdleGuard<R> = (
  agents: readonly TaskStandingAgent[],
) => Effect.Effect<ReadonlySet<string>, QueryError | Schema.SchemaError, R>;

export interface TaskDoneArchive<R> {
  readonly archivedBy: StoredArchive;
  readonly idle: TaskIdleGuard<R>;
}

export interface TaskArchivedAgent {
  readonly id: string;
  readonly userId: string;
  readonly conversationId: string;
}

export interface LabeledAgentEdit extends DescriptionAgentEdit {
  readonly label: string;
}

export interface StoredTask {
  readonly task: Task;
  readonly ownerId: string;
  readonly githubAccess: GitHubAccess;
  readonly text: string;
  readonly agentEdits: readonly LabeledAgentEdit[];
  readonly saved: boolean;
  readonly sectionWriters: readonly DescriptionSectionWriter[];
  readonly brief: string | undefined;
}

export interface NewTask {
  readonly organizationId: string;
  readonly name?: string;
  readonly repository?: string | null;
  readonly githubAccess?: GitHubAccess;
  readonly brief?: string;
  readonly status?: TaskStatus;
  readonly priority?: TaskPriority;
  readonly assigneeId?: string;
  readonly origin?: TaskOrigin;
  readonly parentTaskId?: string;
  readonly mode?: TaskMode;
  readonly madeByStart?: boolean;
  readonly text?: string;
}

export interface TaskChanges {
  readonly name?: string;
  readonly organizationId?: string;
  readonly repository?: string | null;
  readonly githubAccess?: GitHubAccess;
  readonly pinned?: boolean;
  readonly pinPosition?: string;
  readonly readMark?: ReadMark;
  readonly status?: TaskStatus;
  readonly priority?: TaskPriority;
  readonly assigneeId?: string | null;
}

const GitHubAccessSchema = Schema.Literals(Object.values(GITHUB_ACCESS));

const MachineSchema = Schema.Literals(Object.values(AGENT_MACHINE));

function newestAgentColumn<T>(column: typeof agentTable.machine | typeof agentTable.deviceId) {
  const newest = queryBuilder
    .select({ value: column })
    .from(agentTable)
    .where(eq(agentTable.taskId, task.id))
    .orderBy(desc(agentTable.createdAt), desc(agentTable.id))
    .limit(1);
  return sql<T | null>`(${newest})`;
}

const TaskCreatorActorSchema = Schema.Literals([
  DESCRIPTION_ACTOR.DEVELOPER,
  DESCRIPTION_ACTOR.NOTETAKER,
  DESCRIPTION_ACTOR.AGENT,
]);

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
  machine: newestAgentColumn<AgentMachineKind>(agentTable.machine),
  deviceId: newestAgentColumn<string>(agentTable.deviceId),
  parentTaskId: task.parentTaskId,
  mode: task.mode,
  completedAt: task.completedAt,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
};

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
  machine: Schema.NullOr(MachineSchema),
  deviceId: Schema.NullOr(Schema.String),
  parentTaskId: Schema.NullOr(Schema.String),
  mode: taskModeSchema,
  completedAt: Schema.NullOr(InstantColumnSchema),
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

type TaskSummaryRow = typeof TaskSummaryRowSchema.Type;

const ReaderPinSchema = Schema.Struct({
  pinnedAt: InstantColumnSchema,
  pinPosition: Schema.NullOr(Schema.String),
});

type ReaderPin = typeof ReaderPinSchema.Type;

const ReaderMarkSchema = Schema.Struct({
  readThrough: InstantColumnSchema,
  markedUnread: Schema.Boolean,
});

type ReaderMark = typeof ReaderMarkSchema.Type;

const TaskListRowSchema = Schema.Struct({
  ...TaskSummaryRowSchema.fields,
  pinnedAt: Schema.NullOr(InstantColumnSchema),
  pinPosition: Schema.NullOr(Schema.String),
  ...ReaderMarkSchema.fields,
  blocked: Schema.Boolean,
  madeByRun: Schema.Boolean,
});

const TaskRowSchema = Schema.Struct({
  ...TaskSummaryRowSchema.fields,
  agentEdits: Schema.Array(descriptionAgentEditSchema),
  document: Schema.String,
  brief: Schema.NullOr(Schema.String),
});

type TaskRow = typeof TaskRowSchema.Type;

const TaskKeySchema = Schema.Struct({ userId: Schema.String, taskId: Schema.String });

const TaskIdRowSchema = Schema.Struct({ id: Schema.String });

function readersPin(userId: string): SQL | undefined {
  return and(eq(taskPin.taskId, task.id), eq(taskPin.userId, userId));
}

function readersMark(userId: string): SQL | undefined {
  return and(eq(taskRead.taskId, task.id), eq(taskRead.userId, userId));
}

const READER_MARK_COLUMNS = {
  readThrough: sql<Date>`coalesce(${taskRead.readThrough}, ${task.readThrough}, ${task.createdAt})`,
  markedUnread: sql<boolean>`coalesce(${taskRead.markedUnread}, false)`,
};

const findMark = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: ReaderMarkSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select(READER_MARK_COLUMNS)
        .from(task)
        .leftJoin(taskRead, readersMark(userId))
        .where(eq(task.id, taskId))
        .limit(1),
    ),
});

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

const TXID = sql<string>`pg_current_xact_id()::text`;

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

const markRead = SqlSchema.findOneOption({
  Result: TxidRowSchema,
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String, now: Schema.Date }),
  execute: ({ userId, taskId, now }) =>
    Database.use((db) =>
      db
        .insert(taskRead)
        .values({ userId, taskId, readThrough: now })
        .onConflictDoUpdate({
          target: [taskRead.userId, taskRead.taskId],
          set: { readThrough: now, markedUnread: false },
        })
        .returning({ txid: TXID }),
    ),
});

const markSeen = SqlSchema.findOneOption({
  Result: TxidRowSchema,
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String, now: Schema.Date }),
  execute: ({ userId, taskId, now }) =>
    Database.use((db) =>
      db
        .insert(taskRead)
        .values({ userId, taskId, readThrough: now })
        .onConflictDoUpdate({
          target: [taskRead.userId, taskRead.taskId],
          set: { readThrough: now },
        })
        .returning({ txid: TXID }),
    ),
});

const markUnread = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: TxidRowSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .insert(taskRead)
        .values({ userId, taskId, markedUnread: true })
        .onConflictDoUpdate({
          target: [taskRead.userId, taskRead.taskId],
          set: { markedUnread: true },
          setWhere: sql`not ${taskRead.markedUnread}`,
        })
        .returning({ txid: TXID }),
    ),
});

const findAgentLabels = SqlSchema.findAll({
  Request: Schema.Struct({ agentIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({
    id: Schema.String,
    kind: Schema.Literals(Object.values(AGENT_KIND)),
    model: Schema.String,
    title: Schema.NullOr(Schema.String),
    automationName: Schema.NullOr(Schema.String),
  }),
  execute: ({ agentIds }) =>
    Database.use((db) =>
      db
        .select({
          id: agentTable.id,
          kind: agentTable.kind,
          model: agentTable.model,
          title: agentTable.title,
          automationName: agentAutomationNameSql(agentTable),
        })
        .from(agentTable)
        .where(inArray(agentTable.id, agentIds)),
    ),
});

function agentLabelsOf(
  row: TaskRow,
  sectionWriters: readonly DescriptionSectionWriter[],
): TaskStoreEffect<ReadonlyMap<string, string>> {
  const named = [
    ...row.agentEdits.map((edit) => edit.agentId),
    ...sectionWriters.flatMap((writer) => (writer.agentId === undefined ? [] : [writer.agentId])),
  ];
  const agentIds = [...new Set(named)];
  if (agentIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findAgentLabels({ agentIds }),
    (agents) => new Map(agents.map((agent) => [agent.id, agentName(agent)])),
  );
}

function sectionEditOf(
  writer: DescriptionSectionWriter,
  labels: ReadonlyMap<string, string>,
): DescriptionSectionEdit {
  const { section, actor, at } = writer;
  const label = writer.agentId === undefined ? undefined : labels.get(writer.agentId);
  return {
    section,
    actor,
    ...(actor === DESCRIPTION_ACTOR.AGENT ? { label: label ?? UNKNOWN_AGENT_LABEL } : undefined),
    ...(writer.agentId === undefined ? undefined : { agentId: writer.agentId }),
    ...(writer.by === undefined ? undefined : { by: writer.by }),
    at,
    duringCall: false,
  };
}

function journaledEdit(edit: LabeledAgentEdit): DescriptionLastEdit {
  return {
    actor: DESCRIPTION_ACTOR.AGENT,
    label: edit.label,
    agentId: edit.agentId,
    at: edit.at,
    duringCall: false,
  };
}

function storedTaskOf(userId: string, row: TaskRow): TaskStoreEffect<StoredTask> {
  return Effect.gen(function* () {
    const devices = yield* devicesOf([row]);
    const read = yield* Effect.all(
      {
        pin: findPin({ userId, taskId: row.id }),
        mark: findMark({ userId, taskId: row.id }),
        names: readAccountNames(namedAccountsOf([row], devices)),
        written: Effect.flatMap(readSectionWriters(row.id), (sectionWriters) =>
          Effect.map(agentLabelsOf(row, sectionWriters), (labels) => ({ sectionWriters, labels })),
        ),
        lastRevision: readLastEdit(row.id),
        blocks: readTaskBlocks(userId, row.id),
      },
      { concurrency: yield* readConcurrency },
    );
    const { sectionWriters, labels } = read.written;
    const mark = Option.getOrElse(read.mark, () => ({
      readThrough: row.createdAt,
      markedUnread: false,
    }));
    const summary = summaryOf(row, Option.getOrNull(read.pin), mark, read.names, devices);
    const agentEdits = row.agentEdits.map((edit) => ({
      ...edit,
      label: labels.get(edit.agentId) ?? UNKNOWN_AGENT_LABEL,
    }));
    const lastEdit = Option.orElse(read.lastRevision, () =>
      Option.map(Option.fromUndefinedOr(agentEdits.at(-1)), journaledEdit),
    );
    return {
      task: {
        ...summary,
        agentEdits: agentEdits.map(({ agentId, label, at }) => ({ agentId, label, at })),
        ...(Option.isSome(lastEdit) ? { lastEdit: lastEdit.value } : undefined),
        document: { body: row.document, assumptions: [] },
        sectionEdits: sectionWriters.map((writer) => sectionEditOf(writer, labels)),
        ...Option.getOrUndefined(read.blocks),
      },
      ownerId: row.userId,
      githubAccess: row.githubAccess,
      text: row.document,
      agentEdits,
      saved: row.updatedAt.getTime() > row.createdAt.getTime(),
      sectionWriters,
      brief: row.brief ?? undefined,
    };
  });
}

function taskOf(userId: string, row: TaskRow): TaskStoreEffect<Task> {
  return Effect.map(storedTaskOf(userId, row), (stored) => stored.task);
}

function namedAccountsOf(
  rows: readonly TaskSummaryRow[],
  devices: ReadonlyMap<string, Device>,
): readonly string[] {
  return rows.flatMap((row) => {
    const deviceOwner = row.deviceId === null ? undefined : devices.get(row.deviceId)?.userId;
    return [row.userId, row.assigneeId, deviceOwner].filter(
      (account): account is string => account !== null && account !== undefined,
    );
  });
}

function devicesOf(rows: readonly TaskSummaryRow[]): TaskStoreEffect<ReadonlyMap<string, Device>> {
  return devicesNamed(
    rows.flatMap((row) =>
      row.machine !== AGENT_MACHINE.DEVICE || row.deviceId === null ? [] : [row.deviceId],
    ),
  );
}

function runsOnOf(
  row: TaskSummaryRow,
  names: ReadonlyMap<string, string>,
  devices: ReadonlyMap<string, Device>,
): { readonly runsOn?: TaskRunsOn } {
  if (row.machine !== AGENT_MACHINE.DEVICE) return {};
  const found = row.deviceId === null ? undefined : devices.get(row.deviceId);
  const owner = found === undefined ? undefined : names.get(found.userId);
  return {
    runsOn: {
      machine: AGENT_MACHINE.DEVICE,
      ...(found === undefined ? undefined : { deviceId: found.id }),
      ...(found === undefined || owner === undefined
        ? undefined
        : { owner: { userId: found.userId, name: owner } }),
      ...(found === undefined
        ? undefined
        : {
            device: {
              name: found.name,
              kind: DEVICE_KIND.HOST,
              platform: found.platform,
              seenAt: found.lastSeenAt.getTime(),
            },
          }),
    },
  };
}

function summaryOf(
  row: TaskSummaryRow,
  pin: ReaderPin | null,
  mark: ReaderMark,
  names: ReadonlyMap<string, string>,
  devices: ReadonlyMap<string, Device>,
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
    readThrough: mark.readThrough.getTime(),
    markedUnread: mark.markedUnread,
    ...(row.completedAt === null ? undefined : { completedAt: row.completedAt.getTime() }),
    status: row.status,
    priority: row.priority,
    number: row.number,
    ...(row.assigneeId === null || assignee === undefined
      ? undefined
      : { assignee: { userId: row.assigneeId, name: assignee } }),
    ...runsOnOf(row, names, devices),
    ...(row.parentTaskId === null ? undefined : { parentTaskId: row.parentTaskId }),
    mode: row.mode,
  };
}

function originOf(row: TaskSummaryRow): { readonly origin?: TaskOrigin } {
  if (row.creatorActor === DESCRIPTION_ACTOR.DEVELOPER) return {};
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
  mode: taskModeSchema,
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  assigneeId: Schema.NullOr(Schema.String),
  creatorActor: TaskCreatorActorSchema,
  creatorAgentId: Schema.NullOr(Schema.String),
  repository: Schema.NullOr(Schema.String),
  githubAccess: GitHubAccessSchema,
  parentTaskId: Schema.NullOr(Schema.String),
  document: Schema.String,
  brief: Schema.NullOr(Schema.String),
  madeByStart: Schema.Boolean,
  now: Schema.Date,
});

function completedAtOf(status: TaskStatus, now: Date): Date | null {
  return status === TASK_STATUS.DONE || status === TASK_STATUS.CANCELED ? now : null;
}

function taskValues(write: typeof TaskInsertSchema.Type) {
  return {
    ...(write.id === undefined ? undefined : { id: write.id }),
    userId: write.userId,
    organizationId: write.organizationId,
    name: write.name,
    number: write.number,
    mode: write.mode,
    status: write.status,
    completedAt: completedAtOf(write.status, write.now),
    priority: write.priority,
    assigneeId: write.assigneeId,
    creatorActor: write.creatorActor,
    creatorAgentId: write.creatorAgentId,
    madeByStart: write.madeByStart,
    repository: write.repository,
    githubAccess: write.githubAccess,
    parentTaskId: write.parentTaskId,
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

const insertTaskOnce = SqlSchema.findOneOption({
  Request: TaskInsertSchema,
  Result: Schema.Struct({ ...TaskRowSchema.fields, txid: Schema.String }),
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(task)
        .values(taskValues(write))
        .onConflictDoNothing({ target: task.id })
        .returning({ ...TASK_COLUMNS, txid: TXID }),
    ),
});

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

function nextTaskNumber(organizationId: string): TaskStoreEffect<number> {
  return takeTaskNumber(organizationId).pipe(
    Effect.map((taken) => taken.lastNumber),
    Effect.catchTag("NoSuchElementError", Effect.die),
  );
}

const findTasks = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String }),
  Result: TaskListRowSchema,
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select({
          ...TASK_SUMMARY_COLUMNS,
          pinnedAt: taskPin.pinnedAt,
          pinPosition: taskPin.position,
          ...READER_MARK_COLUMNS,
          blocked: taskBlockedFor(userId),
          madeByRun: taskMadeByRun(task.id),
        })
        .from(task)
        .leftJoin(taskPin, readersPin(userId))
        .leftJoin(taskRead, readersMark(userId))
        .where(taskReachableBy(userId))
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

const findTaskHeaders = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, taskIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({
    id: Schema.String,
    organizationId: Schema.String,
    userId: Schema.String,
    name: Schema.String,
    repository: Schema.NullOr(Schema.String),
    status: taskStatusSchema,
    parentTaskId: Schema.NullOr(Schema.String),
    mode: taskModeSchema,
    assigneeId: Schema.NullOr(Schema.String),
    number: Schema.Number,
  }),
  execute: ({ userId, taskIds }) =>
    Database.use((db) =>
      db
        .select({
          id: task.id,
          organizationId: task.organizationId,
          userId: task.userId,
          name: task.name,
          repository: task.repository,
          status: task.status,
          parentTaskId: task.parentTaskId,
          mode: task.mode,
          assigneeId: task.assigneeId,
          number: task.number,
        })
        .from(task)
        .where(and(inArray(task.id, [...taskIds]), taskReachableBy(userId))),
    ),
});

const replaceText = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    taskId: Schema.String,
    text: Schema.String,
    agentEdits: Schema.optionalKey(Schema.Array(descriptionAgentEditSchema)),
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

const lockTask = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: TaskRowSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db.select(TASK_COLUMNS).from(task).where(reachableTask(userId, taskId)).for("update"),
    ),
});

const hasChildren = SqlSchema.findOneOption({
  Request: Schema.Struct({ taskId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ taskId }) =>
    Database.use((db) =>
      db.select({ id: task.id }).from(task).where(eq(task.parentTaskId, taskId)).limit(1),
    ),
});

function sameRepository(one: string | null, other: string | null): boolean {
  if (one === null || other === null) return one === other;
  return one.toLowerCase() === other.toLowerCase();
}

const treeRepositoryHeld = Effect.fnUntraced(function* (
  locked: Pick<TaskRow, "id" | "repository" | "parentTaskId">,
  asked: string | null,
): Effect.fn.Return<void, TaskStoreFailure | TaskTreeRepositoryLocked, DatabaseServices> {
  if (sameRepository(asked, locked.repository)) return;
  const inTree =
    locked.parentTaskId !== null || Option.isSome(yield* hasChildren({ taskId: locked.id }));
  if (inTree) return yield* new TaskTreeRepositoryLocked();
});

const lockTaskPair = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, taskIds: Schema.Array(Schema.String) }),
  Result: TaskRowSchema,
  execute: ({ userId, taskIds }) =>
    Database.use((db) =>
      db
        .select(TASK_COLUMNS)
        .from(task)
        .where(and(inArray(task.id, taskIds), taskReachableBy(userId)))
        .orderBy(task.id)
        .for("update"),
    ),
});

const findAmongAncestors = SqlSchema.findOneOption({
  Request: Schema.Struct({ taskId: Schema.String, parentTaskId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ taskId, parentTaskId }) =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (client) => client`
        with recursive upward(id, parent_task_id) as (
          select id, parent_task_id from task where id = ${parentTaskId}
          union
          select task.id, task.parent_task_id from task
            join upward on task.id = upward.parent_task_id
        )
        select id::text as id from upward where id = ${taskId} limit 1`,
    ),
});

const readTaskRow = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: TaskRowSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) => db.select(TASK_COLUMNS).from(task).where(reachableTask(userId, taskId))),
});

export function checkTreeRepository(
  userId: string,
  taskId: string,
  asked: string | null,
): Effect.Effect<void, TaskStoreFailure | TaskTreeRepositoryLocked, DatabaseServices> {
  return Effect.flatMap(readTaskRow({ userId, taskId }), (row) =>
    Option.isNone(row) ? Effect.void : treeRepositoryHeld(row.value, asked),
  );
}

const TaskColumnChangesSchema = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  organizationId: Schema.optionalKey(Schema.String),
  repository: Schema.optionalKey(Schema.NullOr(Schema.String)),
  githubAccess: Schema.optionalKey(GitHubAccessSchema),
  number: Schema.optionalKey(Schema.Number),
  status: Schema.optionalKey(taskStatusSchema),
  completedAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
  doneBy: Schema.optionalKey(ArchivedByColumnSchema),
  priority: Schema.optionalKey(taskPrioritySchema),
  assigneeId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  parentTaskId: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

type TaskColumnChanges = typeof TaskColumnChangesSchema.Type;

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

const findAgentConversations = SqlSchema.findAll({
  Request: TaskKeySchema,
  Result: Schema.Struct({ id: Schema.String, conversationId: Schema.String }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({ id: agentTable.id, conversationId: agentTable.conversationId })
        .from(agentTable)
        .innerJoin(task, eq(task.id, agentTable.taskId))
        .where(reachableTask(userId, taskId)),
    ),
});

const nameUntitled = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String, name: Schema.String }),
  Result: TaskIdRowSchema,
  execute: ({ userId, taskId, name }) =>
    Database.use((db) =>
      db
        .update(task)
        .set({ name })
        .where(and(reachableTask(userId, taskId), eq(task.name, UNTITLED_TASK_NAME)))
        .returning({ id: task.id }),
    ),
});

const insertOf = (userId: string, started: NewTask & { readonly id?: string }) =>
  Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const named = started.name?.trim() ?? "";
    const brief = started.brief?.trim() ?? "";
    return {
      ...(started.id === undefined ? undefined : { id: started.id }),
      userId,
      organizationId: started.organizationId,
      name: named.length > 0 ? named : UNTITLED_TASK_NAME,
      repository: started.repository ?? null,
      githubAccess: started.githubAccess ?? GITHUB_ACCESS.APP,
      parentTaskId: started.parentTaskId ?? null,
      document: started.text ?? "",
      brief: brief.length > 0 ? brief : null,
      mode: started.mode ?? TASK_MODE.AGENT,
      status: started.status ?? TASK_STATUS.TODO,
      priority: started.priority ?? TASK_PRIORITY.NONE,
      assigneeId: started.assigneeId ?? null,
      creatorActor: started.origin?.actor ?? DESCRIPTION_ACTOR.DEVELOPER,
      creatorAgentId: started.origin?.agentId ?? null,
      madeByStart: started.madeByStart ?? false,
      number: yield* nextTaskNumber(started.organizationId),
      now,
    };
  });

function assigneeAdmitted(
  assigneeId: string | null | undefined,
  organizationId: string,
): Effect.Effect<void, TaskStoreFailure | TaskAssigneeNotMember, DatabaseServices> {
  if (assigneeId === undefined || assigneeId === null) return Effect.void;
  return Effect.flatMap(isWorkspaceMember(assigneeId, organizationId), (member) =>
    member ? Effect.void : Effect.fail(new TaskAssigneeNotMember()),
  );
}

export interface TaskCommitted<A> {
  readonly task: A;
  readonly txid?: string;
}

export interface TaskChanged extends TaskCommitted<Task> {
  readonly archived: readonly TaskArchivedAgent[];
  readonly statusMoved: boolean;
}

export function createTask(
  userId: string,
  started: NewTask,
): Effect.Effect<Task, TaskStoreFailure | TaskAssigneeNotMember, DatabaseServices> {
  return Effect.map(createTaskCommitted(userId, started), (created) => created.task.task);
}

function startedValues(
  userId: string,
  started: NewTask & { readonly id?: string },
  holding: readonly string[],
) {
  return Effect.gen(function* () {
    yield* assigneeAdmitted(started.assigneeId, started.organizationId);
    const values = yield* insertOf(userId, started);
    if (holding.length > 0) yield* lockTasksForBlocks(userId, holding);
    return values;
  });
}

export function createTaskCommitted(
  userId: string,
  started: NewTask,
  holding: readonly string[] = [],
): Effect.Effect<
  TaskCommitted<StoredTask>,
  TaskStoreFailure | TaskAssigneeNotMember,
  DatabaseServices
> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const values = yield* startedValues(userId, started, holding);
        const { txid, ...row } = yield* insertTask(values).pipe(
          Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
        );
        return { task: yield* storedTaskOf(userId, row), txid };
      }),
    ),
  );
}

export interface TaskStartCommitted extends TaskCommitted<StoredTask> {
  readonly made: boolean;
}

export function createTaskCommittedOnce(
  userId: string,
  started: NewTask & { readonly id: string },
  holding: readonly string[] = [],
): Effect.Effect<
  TaskStartCommitted,
  TaskStoreFailure | TaskAssigneeNotMember | TaskIdTaken,
  DatabaseServices
> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const before = yield* readTask(userId, started.id);
        if (Option.isSome(before)) return { task: before.value, made: false };
        const values = yield* startedValues(userId, started, holding);
        const inserted = yield* insertTaskOnce(values);
        if (Option.isSome(inserted)) {
          const { txid, ...row } = inserted.value;
          return { task: yield* storedTaskOf(userId, row), txid, made: true };
        }
        const raced = yield* readTask(userId, started.id);
        if (Option.isNone(raced)) return yield* new TaskIdTaken();
        return { task: raced.value, made: false };
      }),
    ),
  );
}

export function createTaskOnce(
  userId: string,
  started: NewTask & { readonly id: string; readonly text: string },
): Effect.Effect<Option.Option<Task>, TaskStoreFailure | TaskAssigneeNotMember, DatabaseServices> {
  return Effect.gen(function* () {
    yield* assigneeAdmitted(started.assigneeId, started.organizationId);
    const values = yield* insertOf(userId, started);
    const row = yield* insertTaskOnce(values);
    return yield* Effect.transposeOption(Option.map(row, (made) => taskOf(userId, made)));
  });
}

export function listTasks(userId: string): TaskStoreEffect<readonly TaskSummary[]> {
  return Effect.gen(function* () {
    const rows = yield* findTasks({ userId });
    const devices = yield* devicesOf(rows);
    const names = yield* readAccountNames(namedAccountsOf(rows, devices));
    return rows.map((row) => ({
      ...summaryOf(
        row,
        row.pinnedAt === null ? null : { pinnedAt: row.pinnedAt, pinPosition: row.pinPosition },
        row,
        names,
        devices,
      ),
      ...(row.blocked ? { blocked: true } : undefined),
      ...(row.madeByRun ? { madeByRun: true } : undefined),
    }));
  });
}

export function readTask(
  userId: string,
  taskId: string,
): TaskStoreEffect<Option.Option<StoredTask>> {
  return Effect.flatMap(findTask({ userId, taskId }), (found) =>
    Effect.transposeOption(Option.map(found, (row) => storedTaskOf(userId, row))),
  );
}

export function readTaskDescription(
  userId: string,
  taskId: string,
): TaskStoreEffect<Option.Option<Task>> {
  return Effect.flatMap(findTask({ userId, taskId }), (found) =>
    Effect.transposeOption(Option.map(found, (row) => taskOf(userId, row))),
  );
}

export function readTaskWorkspace(
  userId: string,
  taskId: string,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(
    findTaskWorkspace({ userId, taskId }),
    Option.map((row) => row.organizationId),
  );
}

export interface TaskHeader {
  readonly workspaceId: string;
  readonly ownerId: string;
  readonly name: string;
  readonly repository: string | null;
  readonly status: TaskStatus;
  readonly parentTaskId: string | null;
  readonly mode: TaskMode;
  readonly assigneeId: string | null;
  readonly number: number;
}

export function readTaskHeader(
  userId: string,
  taskId: string,
): TaskStoreEffect<Option.Option<TaskHeader>> {
  return Effect.map(readTaskHeaders(userId, [taskId]), (headers) =>
    Option.fromUndefinedOr(headers.get(taskId)),
  );
}

export function readTaskHeaders(
  userId: string,
  taskIds: readonly string[],
): TaskStoreEffect<ReadonlyMap<string, TaskHeader>> {
  if (taskIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findTaskHeaders({ userId, taskIds }),
    (rows) =>
      new Map(
        rows.map((row): [string, TaskHeader] => [
          row.id,
          {
            workspaceId: row.organizationId,
            ownerId: row.userId,
            name: row.name,
            repository: row.repository,
            status: row.status,
            parentTaskId: row.parentTaskId,
            mode: row.mode,
            assigneeId: row.assigneeId,
            number: row.number,
          },
        ]),
      ),
  );
}

export function readTaskForUpdate(
  userId: string,
  taskId: string,
): TaskStoreEffect<Option.Option<StoredTask>> {
  return Effect.flatMap(lockTask({ userId, taskId }), (locked) =>
    Effect.transposeOption(Option.map(locked, (row) => storedTaskOf(userId, row))),
  );
}

export interface DescriptionTextSaveExtras {
  readonly agentEdits?: readonly DescriptionAgentEdit[];
}

export function saveDescriptionText(
  userId: string,
  taskId: string,
  text: string,
  extras: DescriptionTextSaveExtras = {},
): TaskStoreEffect<Option.Option<Task>> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const row = yield* replaceText({ userId, taskId, text, ...extras, now });
    if (Option.isSome(row))
      yield* stampSavedAttachments(taskId, descriptionAttachmentIdsIn(text, taskId));
    return yield* Effect.transposeOption(Option.map(row, (saved) => taskOf(userId, saved)));
  });
}

function columnChangesOf(
  changes: TaskChanges,
  standing: TaskRow,
  now: Date,
  movedNumber: number | undefined,
  doneBy: StoredArchive | undefined,
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
      : {
          status: changes.status,
          completedAt: completedAtOf(changes.status, now),
          doneBy: changes.status === TASK_STATUS.DONE ? (doneBy ?? null) : null,
        }),
    ...(changes.priority === undefined ? undefined : { priority: changes.priority }),
    ...(changes.assigneeId === undefined ? undefined : { assigneeId: changes.assigneeId }),
  };
}

function markAsAsked(
  userId: string,
  taskId: string,
  mark: ReadMark,
  now: Date,
): TaskStoreEffect<Option.Option<typeof TxidRowSchema.Type>> {
  switch (mark) {
    case READ_MARK.READ:
      return markRead({ userId, taskId, now });
    case READ_MARK.SEEN:
      return markSeen({ userId, taskId, now });
    case READ_MARK.UNREAD:
      return markUnread({ userId, taskId });
  }
}

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
    db.update(agentTable).set({ organizationId }).where(eq(agentTable.taskId, taskId)),
  );
  yield* Database.use((db) =>
    db.update(inboxItem).set({ organizationId }).where(eq(inboxItem.taskId, taskId)),
  );
  yield* Database.use((db) =>
    db.update(attachment).set({ organizationId }).where(eq(attachment.taskId, taskId)),
  );
});

const lockStandingAgents = SqlSchema.findAll({
  Request: Schema.Struct({ taskId: Schema.String, agentId: Schema.optionalKey(Schema.String) }),
  Result: Schema.Struct({
    id: Schema.String,
    conversationId: Schema.String,
    createdAt: InstantColumnSchema,
    blank: Schema.Boolean,
  }),
  execute: ({ taskId, agentId }) =>
    Database.use((db) =>
      db
        .select({
          id: agentTable.id,
          conversationId: agentTable.conversationId,
          createdAt: agentTable.createdAt,
          blank: sql<boolean>`${agentTable.descriptionSnapshot} is null and ${agentTable.prompt} is null`,
        })
        .from(agentTable)
        .innerJoin(conversations, eq(conversations.id, agentTable.conversationId))
        .where(
          and(
            eq(agentTable.taskId, taskId),
            agentId === undefined ? undefined : eq(agentTable.id, agentId),
            isNull(agentTable.archivedAt),
          ),
        )
        .orderBy(conversations.id)
        .for("update", { of: conversations }),
    ),
});

const stampArchivedWithTask = SqlSchema.findAll({
  Request: Schema.Struct({
    agentIds: Schema.Array(Schema.String),
    archivedAt: Schema.Date,
    archivedBy: ArchivedByColumnSchema,
  }),
  Result: Schema.Struct({
    id: Schema.String,
    userId: Schema.String,
    conversationId: Schema.String,
  }),
  execute: ({ agentIds, archivedAt, archivedBy }) =>
    Database.use((db) =>
      db
        .update(agentTable)
        .set({ archivedAt, archivedBy })
        .where(and(inArray(agentTable.id, [...agentIds]), isNull(agentTable.archivedAt)))
        .returning({
          id: agentTable.id,
          userId: agentTable.userId,
          conversationId: agentTable.conversationId,
        }),
    ),
});

const lockArchivedWithTask = SqlSchema.findAll({
  Request: Schema.Struct({ taskId: Schema.String, since: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String, archivedAt: InstantColumnSchema }),
  execute: ({ taskId, since }) =>
    Database.use((db) =>
      db
        .select({ id: agentTable.id, archivedAt: agentTable.archivedAt })
        .from(agentTable)
        .where(
          and(
            eq(agentTable.taskId, taskId),
            gte(agentTable.archivedAt, since),
            sql`(${agentTable.archivedBy} ->> 'withTask') = 'true'`,
          ),
        )
        .orderBy(agentTable.id)
        .for("update"),
    ),
});

const clearArchives = SqlSchema.void({
  Request: Schema.Array(Schema.String),
  execute: (agentIds) =>
    Database.use((db) =>
      db
        .update(agentTable)
        .set({ archivedAt: null, archivedBy: null })
        .where(inArray(agentTable.id, [...agentIds])),
    ),
});

const archivedIdleWithTask = Effect.fnUntraced(function* <R>(
  taskId: string,
  agentId: string | undefined,
  archive: TaskDoneArchive<R>,
  now: Date,
) {
  const agents = yield* lockStandingAgents(
    agentId === undefined ? { taskId } : { taskId, agentId },
  );
  if (agents.length === 0) return [];
  const idle = yield* archive.idle(agents);
  const agentIds = agents
    .filter(({ id }) => idle.has(id) && id !== archive.archivedBy.agentId)
    .map(({ id }) => id);
  if (agentIds.length === 0) return [];
  return yield* stampArchivedWithTask({
    agentIds,
    archivedAt: now,
    archivedBy: { ...archive.archivedBy, withTask: true },
  });
});

const broughtBackWithTask = Effect.fnUntraced(function* (taskId: string, completedAt: Date) {
  const archived = yield* lockArchivedWithTask({ taskId, since: completedAt });
  if (archived.length === 0) return;
  yield* clearArchives(archived.map(({ id }) => id));
  yield* Effect.forEach(archived, ({ id, archivedAt }) => reopenAgentInboxItems(id, archivedAt), {
    discard: true,
  });
});

export function updateTask<E = never, R = never, RA = never>(
  userId: string,
  taskId: string,
  changes: TaskChanges,
  moveGuard?: TaskMoveGuard<E, R>,
  doneArchive?: TaskDoneArchive<RA>,
): Effect.Effect<
  Option.Option<Task>,
  TaskStoreFailure | TaskAssigneeNotMember | TaskTreeRepositoryLocked | E,
  DatabaseServices | R | RA
> {
  return Effect.map(
    updateTaskCommitted(userId, taskId, changes, moveGuard, doneArchive),
    Option.map((updated) => updated.task),
  );
}

export function updateTaskCommitted<E = never, R = never, RA = never>(
  userId: string,
  taskId: string,
  changes: TaskChanges,
  moveGuard?: TaskMoveGuard<E, R>,
  doneArchive?: TaskDoneArchive<RA>,
): Effect.Effect<
  Option.Option<TaskChanged>,
  TaskStoreFailure | TaskAssigneeNotMember | TaskTreeRepositoryLocked | E,
  DatabaseServices | R | RA
> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockTask({ userId, taskId });
        if (Option.isNone(locked)) return Option.none();
        if (changes.repository !== undefined) {
          yield* treeRepositoryHeld(locked.value, changes.repository);
        }
        if (changes.organizationId !== undefined && moveGuard !== undefined) {
          yield* moveGuard(
            changes.repository === undefined ? locked.value.repository : changes.repository,
          );
        }
        const now = yield* DateTime.nowAsDate;
        const pinned =
          changes.pinned === undefined
            ? Option.none()
            : yield* pinAsAsked(userId, taskId, changes.pinned, changes.pinPosition, now);
        const marked =
          changes.readMark === undefined
            ? Option.none()
            : yield* markAsAsked(userId, taskId, changes.readMark, now);
        const moved =
          changes.organizationId !== undefined &&
          changes.organizationId !== locked.value.organizationId;
        const movedNumber = moved ? yield* nextTaskNumber(changes.organizationId) : undefined;
        if (moved) {
          yield* forwardTaskNumber({
            organizationId: locked.value.organizationId,
            number: locked.value.number,
            taskId,
          });
        }
        const landsIn = moved ? changes.organizationId : locked.value.organizationId;
        yield* assigneeAdmitted(changes.assigneeId, landsIn);
        const unassigned =
          moved &&
          changes.assigneeId === undefined &&
          locked.value.assigneeId !== null &&
          !(yield* isWorkspaceMember(locked.value.assigneeId, landsIn));
        const startedBy =
          changes.assigneeId === undefined &&
          changes.status === TASK_STATUS.IN_PROGRESS &&
          locked.value.status !== TASK_STATUS.IN_PROGRESS &&
          locked.value.assigneeId === null &&
          (!moved || (yield* isWorkspaceMember(userId, landsIn)));
        const columns = columnChangesOf(
          unassigned
            ? { ...changes, assigneeId: null }
            : startedBy
              ? { ...changes, assigneeId: userId }
              : changes,
          locked.value,
          now,
          movedNumber,
          doneArchive?.archivedBy,
        );
        const { txid: written, ...row } =
          Object.keys(columns).length === 0
            ? { ...locked.value, txid: undefined }
            : yield* applyChanges({ userId, taskId, ...columns }).pipe(
                Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
              );
        const txid =
          written ?? Option.getOrUndefined(pinned)?.txid ?? Option.getOrUndefined(marked)?.txid;
        const archived =
          columns.status === TASK_STATUS.DONE && doneArchive !== undefined
            ? yield* archivedIdleWithTask(taskId, undefined, doneArchive, now)
            : [];
        const finishedAt = locked.value.completedAt;
        if (
          columns.status !== undefined &&
          locked.value.status === TASK_STATUS.DONE &&
          finishedAt !== null
        ) {
          yield* broughtBackWithTask(taskId, finishedAt);
        }
        if (changes.organizationId !== undefined) {
          yield* followingAgentsAndInbox(taskId, row.organizationId);
          if (row.organizationId !== locked.value.organizationId) {
            yield* leaveSections(taskId);
            yield* leaveTaskBlocks(taskId);
          }
        }
        if (columns.status !== undefined) {
          yield* settleTaskInboxItems(taskId, columns.status, now);
          if (!SETTLED.includes(columns.status) && finishedAt !== null) {
            yield* reopenTaskInboxItems(taskId, locked.value.status, finishedAt);
          }
        }
        yield* settleAgentInboxItems(
          archived.map(({ id }) => id),
          now,
        );
        const changed = yield* taskOf(userId, row);
        const statusMoved = columns.status !== undefined;
        return Option.some(
          txid === undefined
            ? { task: changed, archived, statusMoved }
            : { task: changed, txid, archived, statusMoved },
        );
      }),
    ),
  );
}

const parentWritten = (
  userId: string,
  row: TaskRow,
  parentTaskId: string | null,
): TaskStoreEffect<TaskCommitted<Task>> =>
  Effect.gen(function* () {
    if (row.parentTaskId === parentTaskId) return { task: yield* taskOf(userId, row) };
    const { txid, ...changed } = yield* applyChanges({ userId, taskId: row.id, parentTaskId }).pipe(
      Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
    );
    return { task: yield* taskOf(userId, changed), txid };
  });

export function setTaskParent(
  userId: string,
  taskId: string,
  parentTaskId: string | null,
): Effect.Effect<
  Option.Option<TaskCommitted<Task>>,
  TaskStoreFailure | TaskParentUnreached | TaskParentRepositoryDiffers | TaskParentCycle,
  DatabaseServices
> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        if (parentTaskId === null) {
          const locked = yield* lockTask({ userId, taskId });
          if (Option.isNone(locked)) return Option.none();
          return Option.some(yield* parentWritten(userId, locked.value, null));
        }
        if (parentTaskId === taskId) return yield* new TaskParentCycle();
        const rows = yield* lockTaskPair({ userId, taskIds: [taskId, parentTaskId] });
        const child = rows.find((row) => row.id === taskId);
        if (child === undefined) return Option.none();
        const parent = rows.find((row) => row.id === parentTaskId);
        if (parent === undefined || parent.organizationId !== child.organizationId) {
          return yield* new TaskParentUnreached();
        }
        if (!sameRepository(child.repository, parent.repository)) {
          return yield* new TaskParentRepositoryDiffers({ repository: parent.repository });
        }
        yield* client`select pg_advisory_xact_lock(hashtextextended(${child.organizationId}, 0))`;
        if (Option.isSome(yield* findAmongAncestors({ taskId, parentTaskId }))) {
          return yield* new TaskParentCycle();
        }
        return Option.some(yield* parentWritten(userId, child, parentTaskId));
      }),
    ),
  );
}

export function nameUntitledTask(
  userId: string,
  taskId: string,
  name: string,
): TaskStoreEffect<boolean> {
  const named = name.trim();
  if (named.length === 0) return Effect.succeed(false);
  return Effect.map(nameUntitled({ userId, taskId, name: named }), Option.isSome);
}

const findStartMadeTask = SqlSchema.findOneOption({
  Request: Schema.Struct({ taskId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ taskId }) =>
    Database.use((db) =>
      db
        .select({ id: task.id })
        .from(task)
        .where(and(eq(task.id, taskId), eq(task.madeByStart, true)))
        .limit(1),
    ),
});

export function isStartTask(taskId: string): TaskStoreEffect<boolean> {
  return Effect.map(findStartMadeTask({ taskId }), Option.isSome);
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

export function assignUnassignedTask(userId: string, taskId: string): TaskStoreEffect<boolean> {
  return Effect.map(assignUnassignedTaskCommitted(userId, taskId), Option.isSome);
}

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
        .set({ status: TASK_STATUS.IN_PROGRESS, completedAt: null, doneBy: null })
        .where(and(reachableTask(userId, taskId), ne(task.status, TASK_STATUS.IN_PROGRESS)))
        .returning({ txid: TXID }),
    ),
});

export function beginTaskWork(userId: string, taskId: string): TaskStoreEffect<boolean> {
  return Effect.map(beginTaskWorkCommitted(userId, taskId), Option.isSome);
}

export function beginTaskWorkCommitted(
  userId: string,
  taskId: string,
): TaskStoreEffect<Option.Option<{ readonly txid: string }>> {
  return beginTask({ userId, taskId });
}

const SETTLED: readonly TaskStatus[] = [TASK_STATUS.DONE, TASK_STATUS.CANCELED];

const OPEN_PULL_REQUEST_STATES: readonly string[] = [
  PULL_REQUEST_STATE.OPEN,
  PULL_REQUEST_STATE.DRAFT,
];

const findStandingPullRequestStates = SqlSchema.findAll({
  Request: Schema.Struct({ taskId: Schema.String }),
  Result: Schema.Struct({ state: Schema.String }),
  execute: ({ taskId }) =>
    Database.use((db) =>
      db
        .select({ state: sql<string>`${agentTable.published} ->> 'state'`.as("state") })
        .from(agentTable)
        .where(
          and(
            eq(agentTable.taskId, taskId),
            isNull(agentTable.archivedAt),
            isNotNull(agentTable.published),
          ),
        )
        .unionAll(
          db
            .select({ state: sql<string>`${agentRepository.published} ->> 'state'`.as("state") })
            .from(agentRepository)
            .innerJoin(agentTable, eq(agentTable.id, agentRepository.agentId))
            .where(
              and(
                eq(agentTable.taskId, taskId),
                isNull(agentTable.archivedAt),
                isNotNull(agentRepository.published),
              ),
            ),
        ),
    ),
});

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
            isNotNull(inboxItem.openAskMessageId),
          ),
        )
        .limit(1),
    ),
});

const finishTask = SqlSchema.findOneOption({
  Request: Schema.Struct({ taskId: Schema.String, now: Schema.Date }),
  Result: TaskIdRowSchema,
  execute: ({ taskId, now }) =>
    Database.use((db) =>
      db
        .update(task)
        .set({
          status: TASK_STATUS.DONE,
          completedAt: completedAtOf(TASK_STATUS.DONE, now),
          doneBy: null,
        })
        .where(and(eq(task.id, taskId), notInArray(task.status, [...SETTLED])))
        .returning({ id: task.id }),
    ),
});

export function finishTaskWork<R = never>(
  userId: string,
  taskId: string,
  idle: TaskFinishGuard<R>,
  mergeRequired = true,
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
        const merged = pullRequests.some(({ state }) => state === PULL_REQUEST_STATE.MERGED);
        if (mergeRequired && !merged) return false;
        if (Option.isSome(yield* findOpenQuestion({ taskId }))) return false;
        const agents = yield* lockStandingAgents({ taskId });
        if (!(yield* idle(agents))) return false;
        const now = yield* DateTime.nowAsDate;
        const finished = yield* finishTask({ taskId, now });
        if (Option.isNone(finished)) return false;
        yield* settleTaskInboxItems(taskId, TASK_STATUS.DONE, now);
        return true;
      }),
    ),
  );
}

const lockDoneBy = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: Schema.Struct({ status: taskStatusSchema, doneBy: ArchivedByColumnSchema }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({ status: task.status, doneBy: task.doneBy })
        .from(task)
        .where(reachableTask(userId, taskId))
        .for("update"),
    ),
});

export function archiveAgentOfDoneTask<R = never>(
  userId: string,
  taskId: string,
  agentId: string,
  idle: TaskIdleGuard<R>,
): Effect.Effect<readonly TaskArchivedAgent[], TaskStoreFailure, DatabaseServices | R> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockDoneBy({ userId, taskId });
        if (Option.isNone(locked) || locked.value.status !== TASK_STATUS.DONE) return [];
        const archivedBy = locked.value.doneBy;
        if (archivedBy === null) return [];
        const now = yield* DateTime.nowAsDate;
        const archived = yield* archivedIdleWithTask(taskId, agentId, { archivedBy, idle }, now);
        yield* settleAgentInboxItems(
          archived.map(({ id }) => id),
          now,
        );
        return archived;
      }),
    ),
  );
}

export function deleteTask(
  userId: string,
  taskId: string,
  guard?: TaskDeleteGuard,
): Effect.Effect<boolean, TaskStoreFailure | TaskAgentUnstopped, DatabaseServices> {
  return Effect.map(deleteTaskCommitted(userId, taskId, guard), Option.isSome);
}

export function deleteTaskCommitted(
  userId: string,
  taskId: string,
  guard?: TaskDeleteGuard,
): Effect.Effect<
  Option.Option<{ readonly txid: string }>,
  TaskStoreFailure | TaskAgentUnstopped,
  DatabaseServices
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
        const removed = yield* removeTask({ userId, taskId });
        if (Option.isNone(removed)) return Option.none();
        yield* stampConversationsDeleted(conversationIds);
        return Option.some({ txid: removed.value.txid });
      }),
    ),
  );
}
