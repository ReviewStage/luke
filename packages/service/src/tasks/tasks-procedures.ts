/**
 * tasks-procedures.ts -- the account's plans: list, start, open, change, and delete, and each one's edit and history.
 *
 * Every procedure resolves the caller before it touches a row, and every row
 * it touches is one the caller reaches: a plan id another account owns
 * answers exactly as one that names nothing, and so does an id that is no
 * UUID, so nothing is learned about plans the caller does not hold. The
 * developer writes a document in two ways here, each through the plan's one
 * write (`packages/service/src/tasks/description-notes.ts`) that the notetaker and
 * the coding agents save their notes through: `POST /api/plans/{id}/edit` is
 * their edit of the document, saved, or answered as a conflict with the text
 * as it stands now where we wrote it meanwhile and the edit no longer
 * lands, with nothing saved; and a restore puts back an earlier revision.
 * `GET /api/plans/{id}` is the window opening a plan, a read that moves
 * nothing: the list stands newest started first whatever is opened, and
 * `GET /api/workspaces/{workspace}/tasks/{number}` finds the plan's id for
 * a link naming it by its number in its workspace (`task-number-store.ts`). Its
 * `DELETE` stops every coding agent of the plan first, through the one Stop
 * (`packages/service/src/agents/coder-host/stop.ts`), and only then deletes
 * the plan.
 * Each row of the list carries what the plan's coding agents are doing and
 * what they published, in brief, where it has any
 * (`packages/service/src/agents/task-agents.ts`). A pin is a change like a
 * rename, though it is the asking member's own and reads pinned for no one
 * else. A plan is archived no longer: the list's `archived=include`, which
 * an older build still sends, lists no plan more, and an archive asked for
 * settles the plan instead (`archive-settle.ts`).
 *
 * `POST /api/plans/{id}/parent` sets the plan's parent, or clears it with
 * null, under the rules a child is made under (`setTaskParent`), and
 * `POST /api/plans/{id}/relation` moves one relation of the plan to another
 * kind in one transaction (`task-relation.ts`).
 * `POST /api/plans/{id}/blocks` adds or takes away one block of the plan,
 * as Linear's blocked-by and blocks are: the other task, of the plan's own
 * workspace and one the caller reaches, waits on it or is waited on, and a
 * block that would close a cycle is refused
 * (`@repo/database/models/task-block-store`).
 *
 * `/api/plans/{id}/revisions` is the plan's history for the History tab, a
 * page at a time; `/api/plans/{id}/revisions/{seq}` one revision's content
 * beside the one before it; and `/api/plans/{id}/revisions/{seq}/restore`
 * puts that content back as a revision of the developer's
 * (`@repo/database/models/description-revisions`).
 *
 * A plan may name the GitHub repository it is about, at its start or by a
 * later change, and null is a plan with none. A repository is kept only once
 * our GitHub App confirms the plan's workspace reaches it
 * (`packages/service/src/github/workspace-repository.ts`), so a plan never
 * names a repository its workspace could not reach at the moment it was
 * named. A plan starts in the workspace the request names, which the account
 * must be a member of, or in the account's first workspace where it names
 * none; either way the plan belongs to that workspace from then on.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { accountExperimentOn } from "@repo/database/models/account-store";
import { listAgents, readAgentByKey } from "@repo/database/models/agent-store";
import { listRevisions, readRevision } from "@repo/database/models/description-revisions";
import { devicesNamed } from "@repo/database/models/device-store";
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
  /** The plugin's write that makes an account's first workspace, the first time a start needs it. */
  workspaces: WorkspaceSeams;
}

/**
 * The workspace a start lands in: the one the request named, where the
 * account is a member of it, or the account's first workspace, made the
 * first time it is needed, where it named none. A workspace the account is
 * not in answers as one that names nothing. The plugin refusing to make the
 * first workspace is the service unable to start the plan, written down
 * without the plugin's message, which may quote what it refused.
 */
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
  // Note that an account gone between its bearer and here has no workspace to start in.
  if (Option.isNone(first)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  return first.value;
});

/**
 * The plan and the agent a start's earlier request made under the agent's
 * key: a retry after a lost answer is answered with them rather than with a
 * second plan. A key already spent on an agent anywhere else, on another
 * workspace's plan, on no plan, or on a plan the account no longer reaches,
 * is no retry of this start, and is refused as invalid with nothing written.
 */
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

/**
 * The agent the key names on the plan, where the Start made one before it
 * failed: a store write or read after eve took the session failed the
 * Start, though the agent works on. Nothing where it made none, or where it
 * could not be read either.
 */
const agentMadeOn = (userId: string, taskId: string, idempotencyKey: string) =>
  Effect.gen(function* () {
    const made = yield* readAgentByKey(userId, idempotencyKey);
    if (Option.isNone(made) || made.value.taskId !== taskId) return Option.none();
    return Option.some(yield* summaryOf(userId, made.value));
  }).pipe(Effect.orElseSucceed(() => Option.none()));

/**
 * The task as it stands once an agent started on it, which moved it into
 * progress (`beginTaskWork`), so the open document says what the list says;
 * the task as it was made where it cannot be read again just now.
 */
const taskAfterStart = (userId: string, task: Task) =>
  readTaskDescription(userId, task.id).pipe(
    Effect.map(Option.getOrElse(() => task)),
    Effect.catch((failure) => Effect.as(logStoreFailure(failure), task)),
  );

/**
 * The agent a start asks for, started on the plan it just made through the
 * agent's own Start (`startRequestedAgent`), reaching eve as the developer;
 * a refusal is answered beside the plan rather than in its place, since the
 * plan stands either way and the developer's words are theirs to try again.
 * A Start that failed after its agent was made answers that agent, since it
 * works all the same.
 */
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
        // Note that the provider and the model asked for are kept beside the refusal, because a credential refused names neither in its words.
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
          // Note that a reason is left off where a build from before it fails to read the whole answer on an unknown one, losing the task the start made; such a refusal reads as a device that would not take the agent.
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

/** What a restore that saved nothing answers, by why; the store out of reach is any other. */
const RESTORE_REFUSAL: ReadonlyMap<string, HostedRefusal> = new Map<string, HostedRefusal>([
  [DESCRIPTION_SAVE_REFUSAL.NO_TASK, HOSTED_REFUSAL.NOT_FOUND],
  [DESCRIPTION_SAVE_REFUSAL.NO_REVISION, HOSTED_REFUSAL.NOT_FOUND],
  [DESCRIPTION_SAVE_REFUSAL.TOO_LONG, HOSTED_REFUSAL.REQUEST_TOO_LARGE],
]);

/** What an edit that saved nothing answers, by why, where it is not answered in band; the store out of reach is any other. */
const EDIT_REFUSAL: ReadonlyMap<string, HostedRefusal> = new Map<string, HostedRefusal>([
  [DESCRIPTION_SAVE_REFUSAL.NO_TASK, HOSTED_REFUSAL.NOT_FOUND],
]);

/**
 * Keeps the place a create names as its member's last pick, which a later
 * Start of theirs naming none runs at: the cloud, or a device of the
 * member's own, never another's, which no Start of theirs could run on. A
 * task holds no place, so this is all a create's place does where it starts
 * no agent. Note that a pick that fails to keep fails nothing, because the
 * task is already committed, and a create answered with an error would be
 * retried into a second task.
 */
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

/**
 * How a start asks its task to be worked, checked before anything is
 * written: a pilot only for an account with the Pilot experiment on, refused
 * as an invalid request otherwise; agents, or none named, for anyone.
 */
const modeAsked = (userId: string, asked: TaskMode | undefined) =>
  asked !== TASK_MODE.PILOT
    ? Effect.void
    : Effect.flatMap(
        hostedStoreOrUnavailable(accountExperimentOn(userId, EXPERIMENT.PILOT)),
        (on) => (on ? Effect.void : Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)),
      );

/**
 * A relation's refusal answered by name: a task blocking itself and a task
 * of another workspace are invalid, a block closing a cycle is refused as
 * one, a parent under which the task would descend from itself as one, a
 * parent in another repository as a child's repository locked, a parent
 * taken by a start where one stands already as held, a parent or a related
 * task out of reach is not found, and the store out of reach is unavailable.
 */
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

/** A make's refusal answered by name: a repository refused as its reach answered it, an assignee who is no member as invalid, an id another plan holds as not found, and a parent or a relation as `relationRefused` answers it. */
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

/**
 * The block a change names, written for the account: added or taken away,
 * the plan the path names on the side the change says, its refusals
 * answered by name (`relationRefused`). Nothing where the account reaches
 * either task not.
 */
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

/** The plans resource, every procedure to a signed-in caller. */
export function tasksProcedures(seams: TasksProcedureSeams) {
  const writer: Effect.Effect<StoreWriter> = storeWriter({ tools: CODER_TOOL_SET });
  const plans = hosted.plans.use(accountMiddleware(seams.resolveUserId));
  return {
    /**
     * The account's plans, and beside them the agents with no plan in its
     * workspaces; a teammate's plan or agent on their own GitHub token among
     * them where the account's own token reads its repository, asked of
     * GitHub first where the answer kept is older than the hour. The query's
     * `archived=include`, which an older build still sends, lists the
     * archived agents with no plan among the rest, as it did, and no plan
     * more: a plan is archived no longer.
     */
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

    /**
     * A plan started with an empty document as every door makes a task
     * (`createTaskAsked`), and, where it names an agent, that agent started
     * on it. The agent's session is opened for the account the request
     * resolved to (`coder-host/runtime-sessions.ts`); one whose agent's key
     * already started an agent in the workspace answers that agent's plan and
     * the agent (`startedBefore`). A pilot task is refused, before anything is
     * written, to an account without the Pilot experiment (`modeAsked`). An
     * id a plan the account does not reach stands under is refused as a
     * workspace it is not in is. A start sent again under the idempotency key
     * it was taken under is refused as already written without running
     * (`writeReceiptMiddleware`), so none of its checks can refuse a plan it made.
     */
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
      // A retry is answered above first, since its parent may be gone by now, or its device away, while its task stands.
      // An agent is the start, so its plan opens with no planning phase.
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
      // A task holds no place: the place a released desktop names on the task alone runs the agent the
      // create starts, which keeps it as the member's pick once it stands, or is kept as that pick where
      // the create starts none.
      if (input.runsOn !== undefined && agent === undefined) yield* pickKept(userId, input.runsOn);
      // The agent runs where it names, else where a released desktop named on the task alone.
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
      // An agent's Start commits after the task's insert, so its transaction, where it has one, is the later.
      const committed = answer.txid ?? txid;
      return {
        status: TASK_START_STATUS.CREATED,
        body: committed === undefined ? answer : { ...answer, txid: committed },
      };
    }),

    /** The plan a link names by its workspace and its number there, by its id; one the caller does not reach answers as none. */
    find: plans.find.effect(function* ({ input, context }) {
      const found = yield* hostedStoreOrUnavailable(
        taskIdOfNumber(context.userId, input.workspace, input.number),
      );
      if (Option.isNone(found)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { taskId: found.value };
    }),

    /** One plan with its saved document. */
    open: plans.open.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.id);
      const opened = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(opened)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const { task, brief } = opened.value;
      return { plan: task, ...(brief === undefined ? undefined : { brief }) };
    }),

    /**
     * The plan changed as every door changes a task (`task-change.ts`):
     * confirmed, written, and followed through, any archive by the member.
     */
    update: plans.update.use(writeReceiptMiddleware).effect(function* ({ input, context }) {
      const { userId } = context;
      const taskId = yield* pathUuid(input.params.id);
      // Note that a place a released desktop names (`runsOn`) is read and goes nowhere, because a task holds none.
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

    /**
     * One block of the plan added or taken away (`blockWritten`), answered
     * with the plan as it then stands and the transaction the block was
     * written in, none where it stood as asked already. A task the caller
     * does not reach, on either side, answers as no plan.
     */
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

    /**
     * The plan's parent set, or cleared with null (`setTaskParent`), its
     * refusals answered by name (`relationRefused`), and answered with the
     * plan as it then stands and the transaction the parent was written in,
     * none where it stood as asked already.
     */
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

    /**
     * One relation of the plan moved to another kind in one transaction
     * (`moveTaskRelation`), its refusals answered by name
     * (`relationRefused`), and answered as a block's change is: the plan as
     * it then stands, and the transaction the move was written in.
     */
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

    /**
     * Every coding agent of the plan stopped for good first, as a Stop stops
     * one, so none works on for a plan that is gone; then the
     * plan's eve sessions and its agents' retired (`retire-sessions.ts`),
     * with no transaction open; then the plan, under its lock, which reads
     * again which agents stand. An eve that refuses a Stop, an agent with a turn still
     * coming that no Stop can name yet, or an agent started while the others
     * were stopped, leaves the plan standing and refused.
     *
     * The Stops and the retires reach the agents' sessions for the account
     * the request resolved to (`coder-host/runtime-sessions.ts`), the
     * retires a courtesy the delete does not wait on.
     */
    delete: plans.delete.effect(function* ({ input, context }) {
      const { userId } = context;
      const taskId = yield* pathUuid(input.id);
      const retiring = yield* retiringReach(userId);
      const agents = yield* hostedStoreOrUnavailable(
        listAgents(userId, taskId, { includeArchived: true }),
      );
      yield* everyStoppedForGood(writer, userId, agents);
      // The stopped agents' sessions are retired before the delete's transaction, so no lock waits on eve;
      // an agent started meanwhile is none of these, keeps its session, and refuses the delete below.
      yield* hostedStoreOrUnavailable(
        retiredBeforeDelete(retiring)(agents.map(({ conversationId }) => conversationId)),
      );
      const stopped = new Set(agents.map(({ id }) => id));
      const deleted = yield* hostedStoreOrUnavailable(
        deleteTaskCommitted(userId, taskId, { stoppedAgentIds: stopped }).pipe(
          Effect.catchTag("TaskAgentUnstopped", () => Effect.succeed(undefined)),
        ),
      );
      // An agent started while the others were stopped is one this delete has not stopped yet.
      if (deleted === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
      if (Option.isNone(deleted)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { deleted: true as const, txid: deleted.value.txid };
    }),

    /**
     * The developer's edit of the plan's document: answered with the plan as
     * saved and the transaction it was saved in, which a host waits for on
     * the plan's record before it lets a delivery of the plan land, with the
     * text as it now stands and who last wrote it where the edit conflicts
     * with it, or as refused where the plan would be longer than a plan may be.
     */
    edit: plans.edit.effect(function* ({ input, context }) {
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

    /**
     * A page of the plan's history, the newest first. A plan with no history
     * yet answers an empty page, and so does a plan id the account does not
     * own, which it answers no differently.
     */
    revisions: plans.revisions.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.id);
      return yield* hostedStoreOrUnavailable(listRevisions(context.userId, taskId, input.before));
    }),

    /** One revision's content and the content before it. */
    revision: plans.revision.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.id);
      const revision = yield* hostedStoreOrUnavailable(
        readRevision(context.userId, taskId, input.seq),
      );
      if (Option.isNone(revision)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { revision: revision.value };
    }),

    /**
     * One revision's content put back as the plan's, a revision of the
     * developer's naming it, answered with the plan as it now stands and the
     * transaction its revision was written in, none where it changed
     * nothing. It names nothing in a body: the plan and the revision are the
     * path's.
     */
    restore: plans.restore.effect(function* ({ input, context }) {
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
