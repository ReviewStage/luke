import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { accountExperimentOn } from "@repo/database/models/account-store";
import { listAgents, readAgentByKey } from "@repo/database/models/agent-store";
import { devicesNamed } from "@repo/database/models/device-store";
import { listRevisions, readRevision } from "@repo/database/models/description-revisions";
import { keepRunsOnPick } from "@repo/database/models/runs-on-pick";
import {
  addTaskBlock,
  removeTaskBlock,
  type TaskBlockAcrossWorkspaces,
  type TaskBlockCycle,
  type TaskBlockEffect,
  type TaskBlockPair,
  type TaskBlockSelf,
  type TaskBlockWritten,
} from "@repo/database/models/task-block-store";
import { taskIdOfNumber } from "@repo/database/models/task-number-store";
import {
  deleteTaskCommitted,
  listTasks,
  readTask,
  readTaskDescription,
  type StoredTask,
  setTaskParent,
  type TaskAssigneeNotMember,
  type TaskIdTaken,
} from "@repo/database/models/task-store";
import type { WorkspaceSeams } from "@repo/database/models/workspace-seams";
import { ensurePersonalWorkspace, isWorkspaceMember } from "@repo/database/models/workspace-store";
import { type StoreWriter, storeWriter } from "@repo/database/models/writer";
import { AGENT_ARCHIVER, AGENT_MACHINE, LOCAL_AGENT_REFUSAL } from "@repo/features/agent-wire";
import { TASK_START_STATUS } from "@repo/features/contract";
import { DESCRIPTION_EDIT_REFUSAL } from "@repo/features/description-edit";
import {
  startRelationsOf,
  TASK_BLOCK_CHANGE,
  TASK_BLOCK_RELATION,
  TASK_MODE,
  type Task,
  type TaskAgentStart,
  type TaskBlockRequest,
  type TaskMode,
  type TaskRunsOnRequest,
  type TaskStartAnswer,
} from "@repo/features/task-wire";
import { EXPERIMENT } from "@repo/settings";
import { Effect, Option } from "effect";
import { routedSessions } from "../agents/coder-host/runtime-sessions.js";
import { type StartReach, startRequestedAgent } from "../agents/coder-host/start.js";
import { everyStoppedForGood, summaryOf } from "../agents/coder-host/stop.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import type { EveTypedTurn } from "../agents/eve-host/eve-sessions.js";
import { retiredBeforeDelete, retiringReach } from "../agents/retire-sessions.js";
import type { SandboxStopReach } from "../agents/session-sandboxes.js";
import { listTasklessAgents, withTaskAgents } from "../agents/task-agents.js";
import { TASK_LIST_ARCHIVED } from "../core.js";
import { SERVER_TASK_SOURCE } from "../events/server-events.js";
import { refreshRepositoryReads } from "../github/repository-reads.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  pathUuid,
  type UserIdResolver,
} from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";
import { accountMiddleware, hosted, writeReceiptMiddleware } from "../orpc/base.js";
import {
  DESCRIPTION_SAVE_REFUSAL,
  DESCRIPTION_SAVE_STATUS,
  restoreRevision,
  saveDeveloperEdit,
} from "./description-notes.js";
import { taskChangeAsked, taskChangeSettled, taskChangeWritten } from "./task-change.js";
import { createTaskAsked, type TaskCreateRelationRefused } from "./task-create-relation.js";
import { moveTaskRelation, type TaskRelationRefused } from "./task-relation.js";

export interface TasksProcedureSeams extends SandboxStopReach {
  resolveUserId: UserIdResolver;
  workspaces: WorkspaceSeams;
}

const startingWorkspace = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: TasksProcedureSeams,
  userId: string,
  workspaceId: string | undefined,
): Effect.fn.Return<string, HostedRefusal, DatabaseServices> {
  if (workspaceId !== undefined) {
    const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, workspaceId));
    if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return workspaceId;
  }
  const first = yield* hostedStoreOrUnavailable(
    ensurePersonalWorkspace(userId, seams.workspaces).pipe(
      Effect.catchTag("UnknownError", () =>
        Effect.as(
          Effect.logWarning("First workspace not made: the plugin refused"),
          Option.none<string>(),
        ),
      ),
    ),
  );
  if (Option.isNone(first)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  return first.value;
});

const startedBefore = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  idempotencyKey: string,
  organizationId: string,
): Effect.fn.Return<Option.Option<TaskStartAnswer>, HostedRefusal, DatabaseServices> {
  const made = yield* hostedStoreOrUnavailable(readAgentByKey(userId, idempotencyKey));
  if (Option.isNone(made)) return Option.none();
  const task =
    made.value.taskId === null
      ? Option.none()
      : yield* hostedStoreOrUnavailable(readTaskDescription(userId, made.value.taskId));
  if (Option.isNone(task) || task.value.workspaceId !== organizationId) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return Option.some({ plan: task.value, agent: yield* summaryOf(userId, made.value) });
});

const agentMadeOn = (userId: string, taskId: string, idempotencyKey: string) =>
  Effect.gen(function* () {
    const made = yield* readAgentByKey(userId, idempotencyKey);
    if (Option.isNone(made) || made.value.taskId !== taskId) return Option.none();
    return Option.some(yield* summaryOf(userId, made.value));
  }).pipe(Effect.orElseSucceed(() => Option.none()));

const taskAfterStart = (userId: string, task: Task) =>
  readTaskDescription(userId, task.id).pipe(
    Effect.map(Option.getOrElse(() => task)),
    Effect.catch((failure) => Effect.as(logStoreFailure(failure), task)),
  );

const startedAgentOn = (
  userId: string,
  stored: StoredTask,
  agent: TaskAgentStart,
  reached: StartReach | undefined,
) => {
  const { task } = stored;
  return startRequestedAgent(
    routedSessions<EveTypedTurn>(userId),
    userId,
    { taskId: task.id },
    agent,
    undefined,
    reached,
    stored,
  ).pipe(
    Effect.flatMap((started) =>
      Effect.map(
        taskAfterStart(userId, task),
        (plan): TaskStartAnswer => ({
          plan,
          agent: started.agent,
          ...(started.txid === undefined ? undefined : { txid: started.txid }),
        }),
      ),
    ),
    Effect.catch((refusal) =>
      Effect.gen(function* () {
        const made = yield* agentMadeOn(userId, task.id, agent.idempotencyKey);
        if (Option.isSome(made)) {
          const plan = yield* taskAfterStart(userId, task);
          return { plan, agent: made.value } satisfies TaskStartAnswer;
        }
        yield* Effect.logWarning(
          `the agent a task's start asked for was refused: ${refusal.error}`,
        ).pipe(
          Effect.annotateLogs({
            ...(refusal.provider === undefined ? undefined : { provider: refusal.provider }),
            ...(agent.model === undefined ? undefined : { model: agent.model }),
          }),
        );
        const agentRefusal = {
          error: refusal.error,
          ...(refusal.resetsAt === undefined ? undefined : { resetsAt: refusal.resetsAt }),
          ...(refusal.provider === undefined ? undefined : { provider: refusal.provider }),
          ...(refusal.localAgentRefusal === undefined ||
          refusal.localAgentRefusal === LOCAL_AGENT_REFUSAL.NOT_OWNER
            ? undefined
            : { localAgentRefusal: refusal.localAgentRefusal }),
          ...(refusal.extraRepositoryRefusal === undefined
            ? undefined
            : { extraRepositoryRefusal: refusal.extraRepositoryRefusal }),
          ...(refusal.refusedRepository === undefined
            ? undefined
            : { refusedRepository: refusal.refusedRepository }),
        };
        return { plan: task, agentRefusal } satisfies TaskStartAnswer;
      }),
    ),
  );
};

const RESTORE_REFUSAL: ReadonlyMap<string, HostedRefusal> = new Map<string, HostedRefusal>([
  [DESCRIPTION_SAVE_REFUSAL.NO_TASK, HOSTED_REFUSAL.NOT_FOUND],
  [DESCRIPTION_SAVE_REFUSAL.NO_REVISION, HOSTED_REFUSAL.NOT_FOUND],
  [DESCRIPTION_SAVE_REFUSAL.TOO_LONG, HOSTED_REFUSAL.REQUEST_TOO_LARGE],
]);

const EDIT_REFUSAL: ReadonlyMap<string, HostedRefusal> = new Map<string, HostedRefusal>([
  [DESCRIPTION_SAVE_REFUSAL.NO_TASK, HOSTED_REFUSAL.NOT_FOUND],
]);

const pickKept = (userId: string, asked: TaskRunsOnRequest) =>
  Effect.gen(function* () {
    if (asked.machine === AGENT_MACHINE.DEVICE) {
      const device = (yield* devicesNamed([asked.deviceId])).get(asked.deviceId);
      if (device?.userId !== userId) return;
    }
    yield* keepRunsOnPick(userId, asked);
  }).pipe(
    Effect.catch((failure) =>
      Effect.logWarning(`the last Runs on pick could not be kept: ${failure._tag}`),
    ),
  );

const modeAsked = (userId: string, asked: TaskMode | undefined) =>
  asked !== TASK_MODE.PILOT
    ? Effect.void
    : Effect.flatMap(
        hostedStoreOrUnavailable(accountExperimentOn(userId, EXPERIMENT.PILOT)),
        (on) => (on ? Effect.void : Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)),
      );

function relationRefused(
  failure: TaskRelationRefused | TaskCreateRelationRefused | StoreFailure,
): Effect.Effect<never, HostedRefusal> {
  switch (failure._tag) {
    case "TaskBlockCycle":
      return Effect.fail(HOSTED_REFUSAL.TASK_BLOCK_CYCLE);
    case "TaskBlockSelf":
    case "TaskBlockAcrossWorkspaces":
      return Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    case "TaskParentCycle":
      return Effect.fail(HOSTED_REFUSAL.TASK_PARENT_CYCLE);
    case "TaskParentRepositoryDiffers":
      return Effect.fail(HOSTED_REFUSAL.CHILD_REPOSITORY_LOCKED);
    case "TaskParentHeld":
      return Effect.fail(HOSTED_REFUSAL.TASK_PARENT_HELD);
    case "TaskParentUnreached":
    case "TaskRelationUnreached":
      return Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    default:
      return hostedStoreOrUnavailable(Effect.fail(failure));
  }
}

function createRefused(
  failure:
    | HostedRefusal
    | TaskAssigneeNotMember
    | TaskIdTaken
    | TaskCreateRelationRefused
    | StoreFailure,
): Effect.Effect<never, HostedRefusal> {
  if (!("_tag" in failure)) return Effect.fail(failure);
  if (failure._tag === "TaskAssigneeNotMember") return Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  if (failure._tag === "TaskIdTaken") return Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return relationRefused(failure);
}

const blockWritten = (
  userId: string,
  taskId: string,
  change: TaskBlockRequest,
): Effect.Effect<Option.Option<TaskBlockWritten>, HostedRefusal, DatabaseServices> => {
  const pair: TaskBlockPair =
    change.relation === TASK_BLOCK_RELATION.BLOCKED_BY
      ? { blockerTaskId: change.taskId, blockedTaskId: taskId }
      : { blockerTaskId: taskId, blockedTaskId: change.taskId };
  const written: TaskBlockEffect<
    Option.Option<TaskBlockWritten>,
    TaskBlockSelf | TaskBlockAcrossWorkspaces | TaskBlockCycle
  > = change.change === TASK_BLOCK_CHANGE.ADD
    ? addTaskBlock(userId, pair)
    : removeTaskBlock(userId, pair);
  return Effect.catch(written, relationRefused);
};

export function tasksProcedures(seams: TasksProcedureSeams) {
  const writer: Effect.Effect<StoreWriter> = storeWriter({ tools: CODER_TOOL_SET });
  const plans = hosted.plans.use(accountMiddleware(seams.resolveUserId));
  return {
    list: plans.list.effect(function* ({ input, context }) {
      const includeArchived = input.archived === TASK_LIST_ARCHIVED.INCLUDE;
      yield* refreshRepositoryReads(context.userId);
      const tasks = yield* hostedStoreOrUnavailable(
        Effect.flatMap(listTasks(context.userId), (listed) =>
          withTaskAgents(context.userId, listed),
        ),
      );
      const tasklessAgents = yield* hostedStoreOrUnavailable(
        listTasklessAgents(context.userId, { includeArchived }),
      );
      return { plans: tasks, planlessAgents: tasklessAgents };
    }),

    create: plans.create.use(writeReceiptMiddleware).effect(function* ({ input, context }) {
      const { userId } = context;
      const { agent } = input;
      yield* modeAsked(userId, input.mode);
      const organizationId = yield* startingWorkspace(seams, userId, input.workspaceId);
      const before =
        agent === undefined
          ? Option.none()
          : yield* startedBefore(userId, agent.idempotencyKey, organizationId);
      if (Option.isSome(before)) return { status: TASK_START_STATUS.RETRIED, body: before.value };
      const planning = agent === undefined ? input.planning : false;
      const {
        task: stored,
        txid,
        made: _made,
        ...reached
      } = yield* createTaskAsked(
        userId,
        {
          ...(input.id === undefined ? undefined : { id: input.id }),
          organizationId,
          ...(input.name === undefined ? undefined : { name: input.name }),
          ...(input.repository === undefined ? undefined : { repository: input.repository }),
          ...(planning === undefined ? undefined : { planning }),
          ...(input.brief === undefined ? undefined : { brief: input.brief }),
          ...(input.status === undefined ? undefined : { status: input.status }),
          ...(input.priority === undefined ? undefined : { priority: input.priority }),
          ...(input.assigneeId === undefined ? undefined : { assigneeId: input.assigneeId }),
          ...(input.parentTaskId === undefined ? undefined : { parentTaskId: input.parentTaskId }),
          ...(input.mode === undefined ? undefined : { mode: input.mode }),
          relations: startRelationsOf(input),
        },
        SERVER_TASK_SOURCE.SIDEBAR,
      ).pipe(Effect.catch(createRefused));
      if (input.runsOn !== undefined && agent === undefined) yield* pickKept(userId, input.runsOn);
      const runsOnOfAgent = agent?.runsOn ?? input.runsOn;
      const answer: TaskStartAnswer =
        agent === undefined
          ? { plan: stored.task }
          : yield* startedAgentOn(
              userId,
              stored,
              runsOnOfAgent === undefined ? agent : { ...agent, runsOn: runsOnOfAgent },
              reached.repository === null
                ? undefined
                : { repository: reached.repository, access: reached.githubAccess },
            );
      const committed = answer.txid ?? txid;
      return {
        status: TASK_START_STATUS.CREATED,
        body: committed === undefined ? answer : { ...answer, txid: committed },
      };
    }),

    find: plans.find.effect(function* ({ input, context }) {
      const found = yield* hostedStoreOrUnavailable(
        taskIdOfNumber(context.userId, input.workspace, input.number),
      );
      if (Option.isNone(found)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { taskId: found.value };
    }),

    open: plans.open.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.id);
      const opened = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(opened)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const { task, brief } = opened.value;
      return { plan: task, ...(brief === undefined ? undefined : { brief }) };
    }),

    update: plans.update.use(writeReceiptMiddleware).effect(function* ({ input, context }) {
      const { userId } = context;
      const taskId = yield* pathUuid(input.params.id);
      const { runsOn: _runsOn, ...asked } = input.body;
      const confirmed = yield* taskChangeAsked(userId, taskId, asked);
      const task = yield* taskChangeWritten(userId, taskId, confirmed, {
        by: AGENT_ARCHIVER.MEMBER,
        userId,
      });
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      yield* taskChangeSettled(seams, userId, task.value);
      const { task: plan, txid } = task.value;
      return txid === undefined ? { plan } : { plan, txid };
    }),

    block: plans.block.effect(function* ({ input, context }) {
      const { userId } = context;
      const taskId = yield* pathUuid(input.params.id);
      const written = yield* blockWritten(userId, taskId, input.body);
      if (Option.isNone(written)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const opened = yield* hostedStoreOrUnavailable(readTaskDescription(userId, taskId));
      if (Option.isNone(opened)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const { txid } = written.value;
      return txid === undefined ? { plan: opened.value } : { plan: opened.value, txid };
    }),

    parent: plans.parent.effect(function* ({ input, context }) {
      const { userId } = context;
      const taskId = yield* pathUuid(input.params.id);
      const written = yield* Effect.catch(
        setTaskParent(userId, taskId, input.body.parentTaskId),
        relationRefused,
      );
      if (Option.isNone(written)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const { task: plan, txid } = written.value;
      return txid === undefined ? { plan } : { plan, txid };
    }),

    relation: plans.relation.effect(function* ({ input, context }) {
      const { userId } = context;
      const taskId = yield* pathUuid(input.params.id);
      const written = yield* Effect.catch(
        moveTaskRelation(userId, taskId, input.body),
        relationRefused,
      );
      if (Option.isNone(written)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const opened = yield* hostedStoreOrUnavailable(readTaskDescription(userId, taskId));
      if (Option.isNone(opened)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const { txid } = written.value;
      return txid === undefined ? { plan: opened.value } : { plan: opened.value, txid };
    }),

    delete: plans.delete.effect(function* ({ input, context }) {
      const { userId } = context;
      const taskId = yield* pathUuid(input.id);
      const retiring = yield* retiringReach(userId);
      const agents = yield* hostedStoreOrUnavailable(
        listAgents(userId, taskId, { includeArchived: true }),
      );
      yield* everyStoppedForGood(writer, userId, agents);
      yield* hostedStoreOrUnavailable(
        retiredBeforeDelete(retiring)(agents.map(({ conversationId }) => conversationId)),
      );
      const stopped = new Set(agents.map(({ id }) => id));
      const deleted = yield* hostedStoreOrUnavailable(
        deleteTaskCommitted(userId, taskId, { stoppedAgentIds: stopped }).pipe(
          Effect.catchTag("TaskAgentUnstopped", () => Effect.succeed(undefined)),
        ),
      );
      if (deleted === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
      if (Option.isNone(deleted)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { deleted: true as const, txid: deleted.value.txid };
    }),

    editDescription: plans.editDescription.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.params.id);
      const saved = yield* saveDeveloperEdit({ userId: context.userId, taskId }, input.body);
      switch (saved.status) {
        case DESCRIPTION_SAVE_STATUS.SAVED:
          return {
            plan: saved.task,
            ...(saved.txid === undefined ? undefined : { txid: saved.txid }),
          };
        case DESCRIPTION_SAVE_STATUS.CONFLICT:
          return {
            conflict:
              saved.by === undefined
                ? { current: saved.current }
                : { current: saved.current, by: saved.by },
          };
        case DESCRIPTION_SAVE_STATUS.NOT_SAVED:
          if (saved.reason === DESCRIPTION_SAVE_REFUSAL.TOO_LONG) {
            return { refused: DESCRIPTION_EDIT_REFUSAL.TOO_LONG };
          }
          return yield* Effect.fail(EDIT_REFUSAL.get(saved.reason) ?? HOSTED_REFUSAL.UNAVAILABLE);
      }
    }),

    descriptionRevisions: plans.descriptionRevisions.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.id);
      return yield* hostedStoreOrUnavailable(listRevisions(context.userId, taskId, input.before));
    }),

    descriptionRevision: plans.descriptionRevision.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.id);
      const revision = yield* hostedStoreOrUnavailable(
        readRevision(context.userId, taskId, input.seq),
      );
      if (Option.isNone(revision)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { revision: revision.value };
    }),

    restoreDescription: plans.restoreDescription.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.id);
      const restored = yield* restoreRevision({ userId: context.userId, taskId }, input.seq);
      if (restored.status !== DESCRIPTION_SAVE_STATUS.SAVED) {
        return yield* Effect.fail(
          RESTORE_REFUSAL.get(restored.reason) ?? HOSTED_REFUSAL.UNAVAILABLE,
        );
      }
      return {
        plan: restored.task,
        ...(restored.txid === undefined ? undefined : { txid: restored.txid }),
      };
    }),
  };
}
