import {
  AGENT_KIND,
  AGENT_MACHINE,
  type AgentMachineKind,
  PULL_REQUEST_STATE,
} from "@luke/features/agent-wire";
import { GITHUB_ACCESS, type GitHubAccess } from "@luke/features/github-repositories-wire";
import { INBOX_STATUS } from "@luke/features/inbox-wire";
import { agentName } from "@luke/features/model-label";
import { planAttachmentIdsIn } from "@luke/features/plan-attachment-link";
import type { PlanSectionWriter } from "@luke/features/plan-document";
import { type PlanAgentEdit, planAgentEditSchema } from "@luke/features/plan-template";
import {
  PLAN_ACTOR,
  type PlanLastEdit,
  type PlanSectionEdit,
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
import {
  Database,
  type DatabaseServices,
  type QueryError,
  readConcurrency,
  type StoreFailure,
} from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { attachment } from "../schemas/attachment.js";
import { inboxItem } from "../schemas/inbox.js";
import { conversations } from "../schemas/storage.js";
import { task, taskNumberCounter } from "../schemas/task.js";
import { taskPin } from "../schemas/task-pin.js";
import { taskSectionEntry } from "../schemas/task-section.js";
import { agentAutomationNameSql } from "./agent-name.js";
import { ensureGeneralChannel } from "./channel-store.js";
import { InstantColumnSchema } from "./columns.js";
import { type Device, devicesNamed } from "./device-store.js";
import { reopenTaskInboxItems, settleTaskInboxItems } from "./inbox-settle.js";
import { stampSavedAttachments } from "./plan-attachments.js";
import { readLastEdit, readSectionWriters } from "./plan-revisions.js";
import { stampConversationsDeleted } from "./soft-delete.js";
import { leaveTaskBlocks, readTaskBlocks, taskBlockedFor } from "./task-block-store.js";
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
 * no plan. A pin is the reading member's
 * own (`plan-pin.ts`), so a plan of a shared workspace one member pinned
 * reads pinned for them alone, on every Mac they sign in on. A plan's repository is kept here as
 * handed and confirmed nowhere here: whether the account reaches it through
 * the Luke GitHub App is the route's to settle before it calls, on the
 * service that reads GitHub (`github/github-app.ts`), and so is whether the
 * account is a member of the workspace a task starts in. A save is one `update` over the row that
 * stands and never an insert, so a task deleted before a save lands stays
 * deleted, and a save that fails leaves the document as it was. A task's
 * coding agents' conversations go with the task: deleting the task stamps
 * them `deleted_at`, so the purge takes their words seven days on. Every function is an effect over the ambient `SqlClient` and names
 * no database of its own.
 */

export type TaskStoreFailure = StoreFailure;

/** What a task store operation answers: an effect over the ambient client, composed into whatever called it. */
export type TaskStoreEffect<A> = Effect.Effect<A, TaskStoreFailure, DatabaseServices>;

/** The member a task was to be assigned to is no member of its workspace, or of the one it moves to; nothing was written. */
export class TaskAssigneeNotMember extends Data.TaggedError("TaskAssigneeNotMember") {}

/** The change named another repository for a task that has a parent or children, which work in their tree's repository; nothing was written. */
export class TaskTreeRepositoryLocked extends Data.TaggedError("TaskTreeRepositoryLocked") {}

/** A coding agent stands at work that a delete was not told was stopped: one started on the task, or handed a message, while it or the others were stopped. */
export class TaskAgentUnstopped extends Data.TaggedError("TaskAgentUnstopped") {}

/** What a delete that stopped the task's agents first tells it. */
export interface TaskDeleteGuard {
  /** The agents the caller stopped; any other standing refuses the delete. */
  readonly stoppedAgentIds: ReadonlySet<string>;
}

/**
 * What a change that moves a task runs first: given the repository the row
 * names under its lock, the caller's confirmation that the workspace it moves
 * to reaches it, so a repository changed while the move was asked cannot
 * ride into a workspace that does not reach it. Its failure leaves the task
 * unchanged.
 */
export type TaskMoveGuard<E, R> = (repository: string | null) => Effect.Effect<void, E, R>;

/** One of the task's standing agents as a finish reads it, under its conversation's lock. */
export interface TaskStandingAgent {
  readonly id: string;
  readonly conversationId: string;
  readonly createdAt: Date;
  /** Whether it was started blank, handed neither the plan nor a prompt. */
  readonly blank: boolean;
}

/**
 * What a finish of a task's work runs under the task's lock: whether every
 * one of its standing agents stands idle, neither starting nor running, read
 * under their conversations' locks, all of them at once, since they share
 * the transaction's one connection.
 */
export type TaskFinishGuard<R> = (
  agents: readonly TaskStandingAgent[],
) => Effect.Effect<boolean, QueryError | Schema.SchemaError, R>;

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
  /** The developer's own words about the task as they started it; nothing for a task started with none. */
  readonly brief: string | undefined;
  /** Where the task's agents run, as its row holds it, which a Start on it resolves its machine from. */
  readonly runsOn: TaskRunsOnWrite;
}

/**
 * Where a task's agents run, as a write names it and its row holds it: a
 * sandbox with no device, or a device by its id, which the caller confirmed
 * is the writer's own before it wrote it; a device whose row is gone since
 * reads as none.
 */
export interface TaskRunsOnWrite {
  readonly machine: AgentMachineKind;
  readonly deviceId: string | null;
}

/** Where a task's agents run where nothing named it: a sandbox. */
export const TASK_RUNS_IN_CLOUD: TaskRunsOnWrite = {
  machine: AGENT_MACHINE.VERCEL,
  deviceId: null,
};

/**
 * A plan to start: the workspace it starts in, its name where one is given,
 * and the repository it is about where one is chosen. A plan started with no
 * name, or a blank one, stands as `UNTITLED_PLAN_NAME` until it is renamed. A brief is the developer's own words about the task, kept as
 * written; a blank one is none.
 */
export interface NewTask {
  readonly organizationId: string;
  readonly name?: string;
  readonly repository?: string | null;
  /** How the repository was reached as it was named; the App's where none is named. */
  readonly githubAccess?: GitHubAccess;
  readonly brief?: string;
  /** Where the task stands as it starts; to do where none is named. */
  readonly status?: TaskStatus;
  /** How much the task matters as it starts; unweighed where none is named. */
  readonly priority?: TaskPriority;
  /** The member the task is assigned to as it starts, who must be a member of its workspace; no one where none is named. */
  readonly assigneeId?: string;
  /** Who made the task for its member, where they did not make it by hand: Luke on their call, or a coding agent by its id. */
  readonly origin?: TaskOrigin;
  /** Where its agents run; a sandbox where none is named. */
  readonly runsOn?: TaskRunsOnWrite;
  /** The task it is a child of, which the caller confirmed it reaches in the same workspace, and whose repository and machine it took; none for a task at the top. */
  readonly parentTaskId?: string;
  /** How the task is worked, fixed as it starts; by its agents where none is named. */
  readonly mode?: TaskMode;
}

/**
 * What a change to a task names: a new name, a repository or null to clear
 * it, pinned or not, the workspace it moves to, where it stands, or any of
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
  readonly status?: TaskStatus;
  readonly priority?: TaskPriority;
  /** The member the task is assigned to, who must be a member of its workspace, or of the one it moves to; null for no one. */
  readonly assigneeId?: string | null;
}

/** How a task's repository was reached, as a write takes it. */
const GitHubAccessSchema = Schema.Literals(Object.values(GITHUB_ACCESS));

/** Where a task's agents run, as its row holds it. */
const MachineSchema = Schema.Literals(Object.values(AGENT_MACHINE));

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
  machine: task.machine,
  deviceId: task.deviceId,
  parentTaskId: task.parentTaskId,
  mode: task.mode,
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
  machine: MachineSchema,
  deviceId: Schema.NullOr(Schema.String),
  parentTaskId: Schema.NullOr(Schema.String),
  mode: taskModeSchema,
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
  blocked: Schema.Boolean,
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
    kind: Schema.Literals(Object.values(AGENT_KIND)),
    model: Schema.String,
    title: Schema.NullOr(Schema.String),
    automationName: Schema.NullOr(Schema.String),
  }),
  execute: ({ taskId, agentIds }) =>
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
        .where(and(eq(agentTable.taskId, taskId), inArray(agentTable.id, agentIds))),
    ),
});

/**
 * The agents the journal and the sections' writers name, by id, as their rows
 * name them now, so a renamed agent reads renamed everywhere: the label is
 * the name its tab shows (`agentName`), Luke for an operator. The row's own
 * account is the one they are read under.
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
    (agents) => new Map(agents.map((agent) => [agent.id, agentName(agent)])),
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
    duringCall: false,
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

/**
 * The row's plan, as the window and the model read it for `userId`, the
 * reader, whose own pin it carries: its text as the
 * document's body with no assumptions, since they are a section of the text,
 * who last changed each section, as its revisions read, and the tasks it
 * waits on and that wait on it, each one the reader reaches
 * (`task-block-store.ts`). The row's own account is the one its
 * agents are read under. Its last edit is its newest revision, or, before its
 * history begins, the newest save a coding agent made. A task is saved once
 * a save has moved its last save past its start, which no creation and no
 * carrying over does. The reads but the agents' labels, which wait on the
 * section writers, run together outside a transaction.
 */
function storedTaskOf(userId: string, row: TaskRow): TaskStoreEffect<StoredTask> {
  return Effect.gen(function* () {
    const devices = yield* devicesOf([row]);
    const read = yield* Effect.all(
      {
        pin: findPin({ userId, taskId: row.id }),
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
    const summary = summaryOf(row, Option.getOrNull(read.pin), read.names, devices);
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
      runsOn: { machine: row.machine, deviceId: row.deviceId },
    };
  });
}

/** The row's plan alone, as the reader reads it, for the reads and writes that answer one. */
function taskOf(userId: string, row: TaskRow): TaskStoreEffect<Task> {
  return Effect.map(storedTaskOf(userId, row), (stored) => stored.task);
}

/** The accounts a line of the list names: each row's owner, its assignee where it has one, and the owner of the device it runs on. */
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

/** The devices the rows run on, by id; a row in a sandbox names none. */
function devicesOf(rows: readonly TaskSummaryRow[]): TaskStoreEffect<ReadonlyMap<string, Device>> {
  return devicesNamed(
    rows.flatMap((row) =>
      row.machine === AGENT_MACHINE.VERCEL || row.deviceId === null ? [] : [row.deviceId],
    ),
  );
}

/**
 * Where a line's agents run, as the wire says it: nothing for a sandbox;
 * for a device, its id, its owner named by `names`, and its name, kind, platform, and
 * last beat, each left out once the device's row is gone.
 */
function runsOnOf(
  row: TaskSummaryRow,
  names: ReadonlyMap<string, string>,
  devices: ReadonlyMap<string, Device>,
): { readonly runsOn?: TaskRunsOn } {
  if (row.machine === AGENT_MACHINE.VERCEL) return {};
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
              kind: found.kind,
              platform: found.platform,
              seenAt: found.lastSeenAt.getTime(),
            },
          }),
    },
  };
}

/**
 * The row as one line of the list, its owner and its assignee named by `names`. Note that
 * `openedAt` is still answered, as the start, because a desktop through
 * v0.7.1 refuses a summary without it. It goes once a release whose decoder
 * treats it as optional has shipped and v0.7.1 is no longer supported. A pin,
 * the reader's own `pinnedAt` and the `pinPosition` they dragged it to, is
 * answered only where it stands, so a plan that is not pinned reads as every
 * plan did before pins; an owner whose account is gone is named by nothing.
 */
function summaryOf(
  row: TaskSummaryRow,
  pin: ReaderPin | null,
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
  mode: taskModeSchema,
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  assigneeId: Schema.NullOr(Schema.String),
  creatorActor: TaskCreatorActorSchema,
  creatorAgentId: Schema.NullOr(Schema.String),
  repository: Schema.NullOr(Schema.String),
  githubAccess: GitHubAccessSchema,
  machine: MachineSchema,
  deviceId: Schema.NullOr(Schema.String),
  parentTaskId: Schema.NullOr(Schema.String),
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
    mode: write.mode,
    status: write.status,
    completedAt: completedAtOf(write.status, write.now),
    priority: write.priority,
    assigneeId: write.assigneeId,
    creatorActor: write.creatorActor,
    creatorAgentId: write.creatorAgentId,
    repository: write.repository,
    githubAccess: write.githubAccess,
    machine: write.machine,
    deviceId: write.deviceId,
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
  Request: Schema.Struct({ userId: Schema.String }),
  Result: TaskListRowSchema,
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select({
          ...TASK_SUMMARY_COLUMNS,
          pinnedAt: taskPin.pinnedAt,
          pinPosition: taskPin.position,
          blocked: taskBlockedFor(userId),
        })
        .from(task)
        .leftJoin(taskPin, readersPin(userId))
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

/** The columns of a task `readTaskHeader` answers: every one but its plan's. */
const findTaskHeader = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: Schema.Struct({
    organizationId: Schema.String,
    userId: Schema.String,
    name: Schema.String,
    repository: Schema.NullOr(Schema.String),
    status: taskStatusSchema,
    machine: MachineSchema,
    deviceId: Schema.NullOr(Schema.String),
    parentTaskId: Schema.NullOr(Schema.String),
    mode: taskModeSchema,
  }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({
          organizationId: task.organizationId,
          userId: task.userId,
          name: task.name,
          repository: task.repository,
          status: task.status,
          machine: task.machine,
          deviceId: task.deviceId,
          parentTaskId: task.parentTaskId,
          mode: task.mode,
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

/** Whether any task is a child of this one. */
const hasChildren = SqlSchema.findOneOption({
  Request: Schema.Struct({ taskId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ taskId }) =>
    Database.use((db) =>
      db.select({ id: task.id }).from(task).where(eq(task.parentTaskId, taskId)).limit(1),
    ),
});

/**
 * Refuses a change that names another repository for a task in a tree: one
 * with a parent, or with children, works in its tree's repository, so only
 * the repository it already holds, spelled as GitHub spells it, may be named.
 */
const treeRepositoryHeld = Effect.fnUntraced(function* (
  locked: Pick<TaskRow, "id" | "repository" | "parentTaskId">,
  asked: string | null,
): Effect.fn.Return<void, TaskStoreFailure | TaskTreeRepositoryLocked, DatabaseServices> {
  const held = locked.repository;
  if (asked === held) return;
  if (asked !== null && held !== null && asked.toLowerCase() === held.toLowerCase()) return;
  const inTree =
    locked.parentTaskId !== null || Option.isSome(yield* hasChildren({ taskId: locked.id }));
  if (inTree) return yield* new TaskTreeRepositoryLocked();
});

/** The task row as it stands, unlocked: what a caller reads to refuse a change before it stops anything. */
const readTaskRow = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: TaskRowSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) => db.select(TASK_COLUMNS).from(task).where(reachableTask(userId, taskId))),
});

/**
 * Refuses, with `TaskTreeRepositoryLocked`, a repository another than the
 * one a task in a tree holds, as `updateTaskCommitted` does under the task's
 * lock; a caller that stops work before it writes asks first, so a refused
 * change stops nothing. A task the account does not reach passes, for the
 * write to answer as not found.
 */
export function checkTreeRepository(
  userId: string,
  taskId: string,
  asked: string | null,
): Effect.Effect<void, TaskStoreFailure | TaskTreeRepositoryLocked, DatabaseServices> {
  return Effect.flatMap(readTaskRow({ userId, taskId }), (row) =>
    Option.isNone(row) ? Effect.void : treeRepositoryHeld(row.value, asked),
  );
}

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
  machine: Schema.optionalKey(MachineSchema),
  deviceId: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

type TaskColumnChanges = typeof TaskColumnChangesSchema.Type;

/** The row changed: whichever of the name, the workspace and its number there, the repository, the status, the priority, and the assignee the change names, in one statement. */
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

/** The conversations of the task's coding agents, read before the delete cascades the rows that name them. */
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

/**
 * The name written only where the task still stands untitled, so the check
 * and the write are one statement and a name a member gave the task
 * meanwhile is never written over.
 */
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

/**
 * Starts a task under the account, in the workspace it was handed, as one
 * empty document, with the repository it was handed; it stands first in
 * the list. A plan handed no name, or a blank one, starts as
 * `UNTITLED_PLAN_NAME`.
 */
/** A started task's row as it is inserted: its name, or Untitled, its plan's empty text, and its brief, or none for a blank one. */
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
      machine: (started.runsOn ?? TASK_RUNS_IN_CLOUD).machine,
      deviceId: (started.runsOn ?? TASK_RUNS_IN_CLOUD).deviceId,
      parentTaskId: started.parentTaskId ?? null,
      document: "",
      brief: brief.length > 0 ? brief : null,
      mode: started.mode ?? TASK_MODE.AGENT,
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
 * Starts a task as `insertOf` writes it; an assignee who is no member of
 * its workspace refuses it with `TaskAssigneeNotMember`, nothing written.
 */
export function createTask(
  userId: string,
  started: NewTask,
): Effect.Effect<Task, TaskStoreFailure | TaskAssigneeNotMember, DatabaseServices> {
  return Effect.map(createTaskCommitted(userId, started), (created) => created.task.task);
}

/**
 * A task started, as `createTask` starts one, as the service holds it, so a
 * Start on it in the same request need not read it again, and the
 * transaction its row was written in.
 */
export function createTaskCommitted(
  userId: string,
  started: NewTask,
): Effect.Effect<
  TaskCommitted<StoredTask>,
  TaskStoreFailure | TaskAssigneeNotMember,
  DatabaseServices
> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* assigneeAdmitted(started.assigneeId, started.organizationId);
        const { txid, ...row } = yield* insertTask(yield* insertOf(userId, started)).pipe(
          // An insert that returned no row is the database breaking its own contract, not an outcome.
          Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
        );
        return { task: yield* storedTaskOf(userId, row), txid };
      }),
    ),
  );
}

/**
 * Starts a task under the id its maker chose, as an agent's call makes one
 * under an id drawn from its own key, its plan's text the one given, where
 * no task stands under that id yet; nothing where one does, so the call run
 * again, even at once, makes one task between them.
 */
export function createTaskOnce(
  userId: string,
  started: NewTask & { readonly id: string; readonly text: string },
): Effect.Effect<Option.Option<Task>, TaskStoreFailure | TaskAssigneeNotMember, DatabaseServices> {
  return Effect.gen(function* () {
    yield* assigneeAdmitted(started.assigneeId, started.organizationId);
    const values = yield* insertOf(userId, started);
    const row = yield* insertTaskOnce({ ...values, document: started.text });
    return yield* Effect.transposeOption(Option.map(row, (made) => taskOf(userId, made)));
  });
}

/**
 * Every task of every workspace the account is a member of, newest started first, without their documents.
 * Nothing but starting a task moves the order: opening, reading, saving,
 * pinning, and settling one leave every row where it stood, and the order a
 * pin draws is the window's to draw from `pinPosition` and `pinnedAt`. A
 * task waiting on an open task the account reaches is marked blocked
 * (`taskBlockedFor`).
 */
export function listTasks(userId: string): TaskStoreEffect<readonly TaskSummary[]> {
  return Effect.gen(function* () {
    const rows = yield* findTasks({ userId });
    const devices = yield* devicesOf(rows);
    const names = yield* readAccountNames(namedAccountsOf(rows, devices));
    return rows.map((row) => ({
      ...summaryOf(
        row,
        row.pinnedAt === null ? null : { pinnedAt: row.pinnedAt, pinPosition: row.pinPosition },
        names,
        devices,
      ),
      ...(row.blocked ? { blocked: true } : undefined),
    }));
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
 * The task as `readTask` answers it to the window, without the rest the
 * service holds beside it: what opening a plan and answering one after a
 * write need. Nothing for a task of a
 * workspace the account is not in.
 */
export function readTaskPlan(userId: string, taskId: string): TaskStoreEffect<Option.Option<Task>> {
  return Effect.flatMap(findTask({ userId, taskId }), (found) =>
    Effect.transposeOption(Option.map(found, (row) => taskOf(userId, row))),
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
  /** Where the task stands. */
  readonly status: TaskStatus;
  /** Where the task's agents run, as its row holds it. */
  readonly runsOn: TaskRunsOnWrite;
  /** The task it is a child of; null for a task at the top. */
  readonly parentTaskId: string | null;
  /** How the task is worked. */
  readonly mode: TaskMode;
}

/**
 * A task the account reaches, as `readTask` would answer it, in one
 * statement and without its plan or its history: what a read
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
      status: row.status,
      runsOn: { machine: row.machine, deviceId: row.deviceId },
      parentTaskId: row.parentTaskId,
      mode: row.mode,
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
 * The columns of the row the change names; none where it names only a pin.
 * A move takes `movedNumber`, the
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
  };
}

/**
 * The reader's own pin of the plan set as asked: from now, or from the
 * instant already standing, at the position given where one is; or taken
 * away. Every other member's pin stands as it was.
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
 * The task's agents and inbox moved along with it to another workspace, so
 * no row of the task's stays tied to the workspace it left, whose deletion
 * would otherwise take them with it. Note that the inbox's threads go to the
 * new workspace's #general, because a channel is one workspace's and the one
 * a thread stood in has no counterpart there.
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
  moved: boolean,
  now: Date,
) {
  yield* Database.use((db) =>
    db.update(agentTable).set({ organizationId }).where(eq(agentTable.taskId, taskId)),
  );
  // A change naming the workspace the task stands in leaves its threads in their channels.
  const channel = moved ? { channelId: yield* ensureGeneralChannel(organizationId, now) } : {};
  yield* Database.use((db) =>
    db
      .update(inboxItem)
      .set({ organizationId, ...channel })
      .where(eq(inboxItem.taskId, taskId)),
  );
  yield* Database.use((db) =>
    db.update(attachment).set({ organizationId }).where(eq(attachment.taskId, taskId)),
  );
});

/**
 * The task's agents still standing unarchived, each with its conversation
 * locked, the lock every write of its lines and turns takes, in the
 * conversations' order, so two finishes of one task never wait on each other.
 * A line handed to an agent stands awaiting from before its runtime hears it
 * (`dispatch-claim.ts`), so the caller's guard reads such an agent at work.
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
          id: agentTable.id,
          conversationId: agentTable.conversationId,
          createdAt: agentTable.createdAt,
          blank: sql<boolean>`${agentTable.planSnapshot} is null and ${agentTable.prompt} is null`,
        })
        .from(agentTable)
        .innerJoin(conversations, eq(conversations.id, agentTable.conversationId))
        .where(and(eq(agentTable.taskId, taskId), isNull(agentTable.archivedAt)))
        .orderBy(conversations.id)
        .for("update", { of: conversations }),
    ),
});

/**
 * Changes the task, a new name with its document's heading, a repository or
 * none, pinned or not, its workspace, where it stands, and answers it as
 * changed, or nothing where the account reaches no such task. The changes
 * arrive already read under the wire's rules, and a repository already
 * confirmed reachable; a move runs the caller's guard under the row's lock
 * on the repository the task will name once it lands. A change is
 * not a save: the document's `updatedAt` and the list's order stand. The pin
 * is the account's own and no other member's. A task no one is assigned to
 * that the change moves into progress is assigned to the account, unless the
 * change names an assignee of its own. A change that moves the task to Done
 * or Canceled settles its open inbox items, and one that moves it off them
 * to work again opens again the items that move settled (`inbox-settle.ts`).
 */
export function updateTask<E = never, R = never>(
  userId: string,
  taskId: string,
  changes: TaskChanges,
  moveGuard?: TaskMoveGuard<E, R>,
): Effect.Effect<
  Option.Option<Task>,
  TaskStoreFailure | TaskAssigneeNotMember | TaskTreeRepositoryLocked | E,
  DatabaseServices | R
> {
  return Effect.map(
    updateTaskCommitted(userId, taskId, changes, moveGuard),
    Option.map((updated) => updated.task),
  );
}

/**
 * A task changed, as `updateTask` changes one, and the transaction the change
 * committed in, read from the write that changed the row or the reader's pin;
 * none where the change wrote neither.
 */
export function updateTaskCommitted<E = never, R = never>(
  userId: string,
  taskId: string,
  changes: TaskChanges,
  moveGuard?: TaskMoveGuard<E, R>,
): Effect.Effect<
  Option.Option<TaskCommitted<Task>>,
  TaskStoreFailure | TaskAssigneeNotMember | TaskTreeRepositoryLocked | E,
  DatabaseServices | R
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
        // A task no one is on is its mover's once it moves into progress, as Linear's start assigns;
        // an assignee the change names wins, and one taken off a task already in progress stays off.
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
        if (changes.organizationId !== undefined) {
          yield* followingAgentsAndInbox(taskId, row.organizationId, moved, now);
          if (row.organizationId !== locked.value.organizationId) {
            yield* leaveSections(taskId);
            yield* leaveTaskBlocks(taskId);
          }
        }
        // A task moved to Done or Canceled settles its open inbox items, and one moved off them to work
        // again opens again the items that move settled, by its stamp. Note that this runs after its
        // agents moved, so the write locks agent rows before item rows, in the order an archive does.
        if (columns.status !== undefined) {
          yield* settleTaskInboxItems(taskId, columns.status, now);
          const finishedAt = locked.value.completedAt;
          if (!SETTLED.includes(columns.status) && finishedAt !== null) {
            yield* reopenTaskInboxItems(taskId, locked.value.status, finishedAt);
          }
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
 * the task has a name of its own or is no task the account reaches. A rename, like `updateTask`'s, is not a save, so the list's
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
        .select({ state: sql<string>`${agentTable.published} ->> 'state'` })
        .from(agentTable)
        .where(
          and(
            eq(agentTable.taskId, taskId),
            isNull(agentTable.archivedAt),
            isNotNull(agentTable.published),
          ),
        ),
    ),
});

/**
 * One inbox item of the task holding a question open for the developer:
 * open, and holding an ask open, which a notice, a post that asked nothing
 * and waits on their nod alone, never does (the inbox store's own `ASKING`,
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
            isNotNull(inboxItem.openAskMessageId),
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
 * row lock, each agent under its conversation's,
 * so a start or a turn racing the finish either landed before the read,
 * which then refuses, or waits on the lock and reopens the task after.
 * Like any change it is not a save, so the list's order stands. A finish
 * settles the task's open inbox items, notices among them
 * (`inbox-settle.ts`).
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

/**
 * Deletes the task and its document, and stamps its coding agents'
 * conversations cleared; false where the account reached no such task. The agents'
 * conversations are read before the delete, because the delete cascades
 * the agent rows that name them.
 *
 * A caller that stopped the task's agents first names the ones it stopped,
 * and the delete fails with `TaskAgentUnstopped` where any other stands. The
 * task's row is locked before the agents are read, so a Start racing the
 * delete either landed its agent before the read, which then refuses, or
 * waits on the lock and finds no task to start on. Nothing here reaches
 * past the database, so the lock is held only for these statements: what a
 * caller does to the agents it stopped, such as retiring their sessions,
 * it does before, and the stopped set re-checked here is what keeps an
 * agent started meanwhile, whose session it never touched, standing.
 */
export function deleteTask(
  userId: string,
  taskId: string,
  guard?: TaskDeleteGuard,
): Effect.Effect<boolean, TaskStoreFailure | TaskAgentUnstopped, DatabaseServices> {
  return Effect.map(deleteTaskCommitted(userId, taskId, guard), Option.isSome);
}

/** A task deleted, as `deleteTask` deletes one, and the transaction its row went in; none where the account reached no such task. */
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
