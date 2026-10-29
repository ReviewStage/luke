/**
 * tasks-procedures.ts -- the account's plans: list, start, open, change, and delete, and each one's edit and history.
 *
 * Every procedure resolves the caller before it touches a row, and every row
 * it touches is one the caller reaches: a plan id another account owns
 * answers exactly as one that names nothing, and so does an id that is no
 * UUID, so nothing is learned about plans the caller does not hold. The
 * developer writes a document in two ways here, each through the plan's one
 * write (`packages/service/src/tasks/plan-notes.ts`) that the notetaker and
 * the coding agents save their notes through: `POST /api/plans/{id}/edit` is
 * their edit of the document, saved, or answered as a conflict with the text
 * as it stands now where Luke wrote it meanwhile and the edit no longer
 * lands, with nothing saved; and a restore puts back an earlier revision.
 * `GET /api/plans/{id}` is the window opening a plan, a read that moves
 * nothing: the list stands newest started first whatever is opened. Its
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
 * `POST /api/plans/{id}/blocks` adds or takes away one block of the plan,
 * as Linear's blocked-by and blocks are: the other task, of the plan's own
 * workspace and one the caller reaches, waits on it or is waited on, and a
 * block that would close a cycle is refused
 * (`@luke/database/models/task-block-store`).
 *
 * `/api/plans/{id}/revisions` is the plan's history for the History tab, a
 * page at a time; `/api/plans/{id}/revisions/{seq}` one revision's content
 * beside the one before it; and `/api/plans/{id}/revisions/{seq}/restore`
 * puts that content back as a revision of the developer's
 * (`@luke/database/models/plan-revisions`).
 *
 * A plan may name the GitHub repository it is about, at its start or by a
 * later change, and null is a plan with none. A repository is kept only once
 * the Luke GitHub App confirms the plan's workspace reaches it
 * (`packages/service/src/github/workspace-repository.ts`), so a plan never
 * names a repository its workspace could not reach at the moment it was
 * named. A plan starts in the workspace the request names, which the account
 * must be a member of, or in the account's first workspace where it names
 * none; either way the plan belongs to that workspace from then on.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { accountExperimentOn } from "@luke/database/models/account-store";
import { listAgents, readAgentByKey } from "@luke/database/models/agent-store";
import { listRevisions, readRevision } from "@luke/database/models/plan-revisions";
import { keepRunsOnPick } from "@luke/database/models/runs-on-pick";
import {
  addTaskBlock,
  removeTaskBlock,
  type TaskBlockAcrossWorkspaces,
  type TaskBlockCycle,
  type TaskBlockEffect,
  type TaskBlockPair,
  type TaskBlockSelf,
  type TaskBlockWritten,
} from "@luke/database/models/task-block-store";
import {
  checkTreeRepository,
  createTaskCommitted,
  deleteTaskCommitted,
  listTasks,
  readTaskHeader,
  readTaskPlan,
  type StoredTask,
  type TaskHeader,
  type TaskRunsOnWrite,
  updateTaskCommitted,
} from "@luke/database/models/task-store";
import type { WorkspaceSeams } from "@luke/database/models/workspace-seams";
import { ensurePersonalWorkspace, isWorkspaceMember } from "@luke/database/models/workspace-store";
import { type StoreWriter, storeWriter } from "@luke/database/models/writer";
import { AGENT_MACHINE, LOCAL_AGENT_REFUSAL } from "@luke/features/agent-wire";
import { TASK_START_STATUS } from "@luke/features/contract";
import { GITHUB_ACCESS, type GitHubAccess } from "@luke/features/github-repositories-wire";
import { PLAN_EDIT_REFUSAL } from "@luke/features/plan-edit";
import {
  TASK_BLOCK_CHANGE,
  TASK_BLOCK_RELATION,
  TASK_MODE,
  type Task,
  type TaskAgentStart,
  type TaskBlockRequest,
  type TaskMode,
  type TaskRunsOnRequest,
  type TaskStartAnswer,
} from "@luke/features/task-wire";
import { EXPERIMENT } from "@luke/settings";
import { Data, Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import { LocalAgentRefused, taskRunsOnChoice } from "../agents/coder-host/agent-runtime-choice.js";
import { type StartReach, startRequestedAgent } from "../agents/coder-host/start.js";
import {
  type EveReach,
  eveFor,
  everyStoppedForGood,
  everyStopsForGood,
  summaryOf,
} from "../agents/coder-host/stop.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import type { EveTypedTurn } from "../agents/eve-host/eve-sessions.js";
import { retiredBeforeDelete, retiringReach } from "../agents/retire-sessions.js";
import type { SandboxStopReach } from "../agents/session-sandboxes.js";
import { listTasklessAgents, withTaskAgents } from "../agents/task-agents.js";
import { TASK_LIST_ARCHIVED } from "../core.js";
import { recordServerEvent, SERVER_EVENT, SERVER_TASK_SOURCE } from "../events/server-events.js";
import type { GitHubApp } from "../github/github-app.js";
import { refreshRepositoryReads } from "../github/repository-reads.js";
import { workspaceRepository } from "../github/workspace-repository.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  localAgentRefused,
  pathUuid,
  type UserIdResolver,
} from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { archiveAskedStatus } from "./archive-settle.js";
import { tellPilotOfMergePolicy, tellPilotOfRunning } from "./pilot-switch-notice.js";
import {
  PLAN_SAVE_REFUSAL,
  PLAN_SAVE_STATUS,
  restoreRevision,
  saveDeveloperEdit,
} from "./plan-notes.js";
import { type TaskParent, taskParentOf } from "./task-parent.js";

export interface TasksProcedureSeams extends EveReach, SandboxStopReach {
  resolveUserId: UserIdResolver;
  /** The plugin's write that makes an account's first workspace, the first time a start needs it. */
  workspaces: WorkspaceSeams;
}

/**
 * The repository as the row keeps it, with how it was reached: null where
 * none was named, or the full name as GitHub spells it once the workspace's
 * installation, or else the member's own token, reaches it
 * (`packages/service/src/github/workspace-repository.ts`). The workspace
 * is read only where a repository is named.
 */
const reachableRepository = /* @__PURE__ */ Effect.fnUntraced(function* (
  workspace: Effect.Effect<string, HostedRefusal, DatabaseServices>,
  repository: string | null | undefined,
  member: string | undefined,
): Effect.fn.Return<
  { readonly repository: string | null; readonly githubAccess: GitHubAccess },
  HostedRefusal,
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  if (repository === undefined || repository === null) {
    return { repository: null, githubAccess: GITHUB_ACCESS.APP };
  }
  const organizationId = yield* workspace;
  const reached = yield* workspaceRepository(organizationId, repository, member);
  return { repository: reached.repository.fullName, githubAccess: reached.access };
});

/** The account's plan without its document, or not found for a plan it does not reach. */
const reachedTask = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  taskId: string,
): Effect.fn.Return<TaskHeader, HostedRefusal, DatabaseServices> {
  const reached = yield* hostedStoreOrUnavailable(readTaskHeader(userId, taskId));
  if (Option.isNone(reached)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return reached.value;
});

/** A top pilot task, whose merge policy or running switch a switch changes; any other task's is refused, a child's being its top task's. */
const topPilotTask = /* @__PURE__ */ Effect.fnUntraced(function* (stored: TaskHeader) {
  if (stored.mode !== TASK_MODE.PILOT || stored.parentTaskId !== null) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
});

/** A move the workspace's GitHub refused under the plan's lock, carried out of the store's change as the procedure's refusal. */
class MoveRefused extends Data.TaggedError("MoveRefused")<{ readonly refusal: HostedRefusal }> {}

/**
 * The workspace a plan moves to, confirmed: the plan is the account's own,
 * since a teammate's plan moved out of a shared workspace would leave the
 * teammates who wrote it behind, and the account is a member of the
 * workspace, which answers as none where it is not. That the workspace's
 * GitHub reaches the plan's repository is confirmed under the plan's lock
 * (`movedRepositoryReached`), so a move never strands one.
 */
const movedToWorkspace = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  stored: TaskHeader,
  workspaceId: string,
): Effect.fn.Return<string, HostedRefusal, DatabaseServices> {
  if (stored.ownerId !== userId) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, workspaceId));
  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return workspaceId;
});

/** The move's guard: the workspace's GitHub reaches the repository the plan names under its lock, where it names one. */
const movedRepositoryReached =
  (workspaceId: string, member: string) =>
  (
    repository: string | null,
  ): Effect.Effect<void, MoveRefused, GitHubApp | HttpClient.HttpClient | DatabaseServices> =>
    repository === null
      ? Effect.void
      : workspaceRepository(workspaceId, repository, member).pipe(
          Effect.asVoid,
          Effect.mapError((refusal) => new MoveRefused({ refusal })),
        );

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
      : yield* hostedStoreOrUnavailable(readTaskPlan(userId, made.value.taskId));
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
 * The agent a start asks for, started on the plan it just made through the
 * agent's own Start (`startRequestedAgent`), reaching eve as the developer;
 * a refusal is answered beside the plan rather than in its place, since the
 * plan stands either way and the developer's words are theirs to try again.
 * A Start that failed after its agent was made answers that agent, since it
 * works all the same.
 */
/**
 * The task as it stands once an agent started on it, which moved it into
 * progress (`beginTaskWork`), so the open document says what the list says;
 * the task as it was made where it cannot be read again just now.
 */
const taskAfterStart = (userId: string, task: Task) =>
  readTaskPlan(userId, task.id).pipe(
    Effect.map(Option.getOrElse(() => task)),
    Effect.catch((failure) => Effect.as(logStoreFailure(failure), task)),
  );

const startedAgentOn = (
  seams: TasksProcedureSeams,
  request: Request,
  userId: string,
  stored: StoredTask,
  agent: TaskAgentStart,
  reached: StartReach | undefined,
) => {
  const { task } = stored;
  return startRequestedAgent(
    eveFor<EveTypedTurn>(seams, request, userId),
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
        };
        return { plan: task, agentRefusal } satisfies TaskStartAnswer;
      }),
    ),
  );
};

/** What a restore that saved nothing answers, by why; the store out of reach is any other. */
const RESTORE_REFUSAL: ReadonlyMap<string, HostedRefusal> = new Map<string, HostedRefusal>([
  [PLAN_SAVE_REFUSAL.NO_TASK, HOSTED_REFUSAL.NOT_FOUND],
  [PLAN_SAVE_REFUSAL.NO_REVISION, HOSTED_REFUSAL.NOT_FOUND],
  [PLAN_SAVE_REFUSAL.TOO_LONG, HOSTED_REFUSAL.REQUEST_TOO_LARGE],
]);

/** What an edit that saved nothing answers, by why, where it is not answered in band; the store out of reach is any other. */
const EDIT_REFUSAL: ReadonlyMap<string, HostedRefusal> = new Map<string, HostedRefusal>([
  [PLAN_SAVE_REFUSAL.NO_TASK, HOSTED_REFUSAL.NOT_FOUND],
]);

/**
 * Where a task runs its agents as a start or a change asks it, checked
 * against the asking member's own devices (`taskRunsOnChoice`) before
 * anything is written; a device refused is answered as a Start on it would
 * be, naming why.
 */
const runsOnAsked = (userId: string, asked: TaskRunsOnRequest) =>
  Effect.map(
    taskRunsOnChoice(userId, asked).pipe(
      Effect.catch((failure) =>
        failure instanceof LocalAgentRefused
          ? Effect.fail(localAgentRefused(failure.reason))
          : hostedStoreOrUnavailable(Effect.fail(failure)),
      ),
    ),
    (choice) => ({ machine: choice.machine, deviceId: choice.deviceId ?? null }),
  );

/** Whether a place a request names is the one a task holds: the cloud, or the same device. */
function runsOnStands(asked: TaskRunsOnRequest, held: TaskRunsOnWrite): boolean {
  return (
    asked.machine === held.machine &&
    (asked.machine === AGENT_MACHINE.VERCEL || asked.deviceId === held.deviceId)
  );
}

/**
 * The parent a start names, confirmed in the workspace it starts in
 * (`task-parent.ts`): one the account does not reach is not found, as any
 * task it does not reach is, and a start naming another repository than the
 * parent's, or another place to run, is refused by name; nothing is written
 * either way.
 */
const parentAsked = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  organizationId: string,
  input: {
    readonly parentTaskId: string;
    readonly repository?: string | null;
    readonly runsOn?: TaskRunsOnRequest;
  },
): Effect.fn.Return<TaskParent, HostedRefusal, DatabaseServices> {
  const parent = yield* taskParentOf(
    userId,
    organizationId,
    input.parentTaskId,
    input.repository,
  ).pipe(
    Effect.catch((failure) => {
      if (failure._tag === "TaskParentUnreached") return Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      if (failure._tag === "TaskParentRepositoryDiffers") {
        return Effect.fail(HOSTED_REFUSAL.CHILD_REPOSITORY_LOCKED);
      }
      return hostedStoreOrUnavailable(Effect.fail(failure));
    }),
  );
  if (input.runsOn !== undefined && !runsOnStands(input.runsOn, parent.runsOn)) {
    return yield* Effect.fail(HOSTED_REFUSAL.RUNS_ON_LOCKED);
  }
  return parent;
});

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
 * Where a task runs is set when it is created and kept: a change that names
 * the place it already holds is nothing to write, and one that names another
 * is refused (`RUNS_ON_LOCKED`) before anything is stopped or written. The
 * field stays on the wire for builds that still send it. Note that the
 * stored place is compared, not the device's row, so a task whose device
 * was removed still holds it.
 */
const runsOnChange = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  taskId: string,
  asked: TaskRunsOnRequest | undefined,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices> {
  if (asked === undefined) return;
  const { runsOn } = yield* reachedTask(userId, taskId);
  if (!runsOnStands(asked, runsOn)) return yield* Effect.fail(HOSTED_REFUSAL.RUNS_ON_LOCKED);
});

/**
 * The block a change names, written for the account: added or taken away,
 * the plan the path names on the side the change says. Its refusals are
 * answered by name: a task blocking itself and a task of another workspace
 * are invalid, a block closing a cycle is refused as one, and the store out
 * of reach is unavailable. Nothing where the account reaches either task not.
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
  return written.pipe(
    Effect.catch((failure) =>
      failure._tag === "TaskBlockCycle"
        ? Effect.fail(HOSTED_REFUSAL.TASK_BLOCK_CYCLE)
        : failure._tag === "TaskBlockSelf" || failure._tag === "TaskBlockAcrossWorkspaces"
          ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)
          : hostedStoreOrUnavailable(Effect.fail(failure)),
    ),
  );
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
     * A plan started with an empty document, its repository confirmed, and,
     * where it names an agent, that agent started on it: a start naming an agent and no
     * repository is refused as an agent's Start on such a plan is, before
     * anything is written, and the agent's session is opened as the
     * request's own caller (`coder-host/stop.ts`'s `eveFor`); one whose
     * agent's key already started an agent in the workspace answers that
     * agent's plan and the agent (`startedBefore`). A pilot task is refused,
     * also before anything is written, to an account without the Pilot
     * experiment (`modeAsked`). A plan started as a child of another takes
     * its parent's repository and place to run (`parentAsked`), confirmed
     * again as any start's repository is.
     */
    create: plans.create.effect(function* ({ input, context }) {
      const { userId, request } = context;
      const { agent } = input;
      yield* modeAsked(userId, input.mode);
      const organizationId = yield* startingWorkspace(seams, userId, input.workspaceId);
      const before =
        agent === undefined
          ? Option.none()
          : yield* startedBefore(userId, agent.idempotencyKey, organizationId);
      if (Option.isSome(before)) return { status: TASK_START_STATUS.RETRIED, body: before.value };
      // A retry is answered above first, since its parent may be gone by now, or its device away, while its task stands.
      const { parentTaskId } = input;
      const parent =
        parentTaskId === undefined
          ? undefined
          : yield* parentAsked(userId, organizationId, { ...input, parentTaskId });
      const repository = parent === undefined ? input.repository : parent.repository;
      if (agent !== undefined && (repository === undefined || repository === null)) {
        return yield* Effect.fail(HOSTED_REFUSAL.NO_REPOSITORY);
      }
      // Where its agents run is checked before anything is written, so a device refused starts no task;
      // a child runs where its parent runs, which was confirmed as the parent was made.
      const runsOn =
        parent === undefined && input.runsOn !== undefined
          ? yield* runsOnAsked(userId, input.runsOn)
          : parent?.runsOn;
      const reached = yield* reachableRepository(
        Effect.succeed(organizationId),
        repository,
        userId,
      );
      // An agent is the start, so its plan opens with no planning phase.
      const planning = agent === undefined ? input.planning : false;
      const { task: stored, txid } = yield* createTaskCommitted(userId, {
        organizationId,
        ...(input.name === undefined ? undefined : { name: input.name }),
        repository: reached.repository,
        githubAccess: reached.githubAccess,
        ...(planning === undefined ? undefined : { planning }),
        ...(input.brief === undefined ? undefined : { brief: input.brief }),
        ...(input.status === undefined ? undefined : { status: input.status }),
        ...(input.priority === undefined ? undefined : { priority: input.priority }),
        ...(input.assigneeId === undefined ? undefined : { assigneeId: input.assigneeId }),
        ...(runsOn === undefined ? undefined : { runsOn }),
        ...(parent === undefined ? undefined : { parentTaskId: parent.id }),
        ...(input.mode === undefined ? undefined : { mode: input.mode }),
      }).pipe(
        Effect.catch((failure) =>
          failure._tag === "TaskAssigneeNotMember"
            ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)
            : hostedStoreOrUnavailable(Effect.fail(failure)),
        ),
      );
      // Where the task runs is kept as the member's last pick, which a task an agent makes for them starts on
      // (`agentMadeRunsOn`), though a child's is its parent's rather than a pick. Note that a pick that fails
      // to keep fails nothing, because the task is already committed, and a create answered with an error
      // would be retried into a second task.
      if (input.runsOn !== undefined && parent === undefined) {
        yield* keepRunsOnPick(userId, input.runsOn).pipe(
          Effect.catch((failure) =>
            Effect.logWarning(`the last Runs on pick could not be kept: ${failure._tag}`),
          ),
        );
      }
      yield* recordServerEvent(SERVER_EVENT.TASK_CREATE, userId, {
        source: SERVER_TASK_SOURCE.SIDEBAR,
      });
      const answer: TaskStartAnswer =
        agent === undefined
          ? { plan: stored.task }
          : yield* startedAgentOn(
              seams,
              request,
              userId,
              stored,
              agent,
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

    /** One plan with its saved document. */
    open: plans.open.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.id);
      const opened = yield* hostedStoreOrUnavailable(readTaskPlan(context.userId, taskId));
      if (Option.isNone(opened)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { plan: opened.value };
    }),

    /**
     * The plan's name, its repository, its pin, its workspace,
     * where it stands, its assignee, or any of them changed, answered with
     * its document; an assignee who is no member of the plan's workspace, or
     * of the one it moves to, is refused as an invalid request. A repository and a
     * move are confirmed before the row is touched, so a refused one leaves
     * the rest unchanged too; a repository named beside a move is confirmed
     * in the workspace the plan moves to, and a move confirms the repository
     * the row names under its lock, so one changed meanwhile is the one
     * confirmed.
     *
     * A merge policy and the running switch are switched on a pilot task at
     * the top of its tree alone, and refused as an invalid request on any
     * other; one that moves is told to the task's pilot as the member's words
     * once it is written (`pilot-switch-notice.ts`).
     *
     * A plan is archived no longer; an archive an older build asks for
     * stops every coding agent of the plan first, as a Stop stops one, then
     * settles the plan instead, and an unarchive puts it back to work
     * (`archive-settle.ts`); a status named beside either is the one
     * written. An eve that refuses a Stop, or an agent still coming up or
     * with a message awaiting its turn, which no Stop can name yet, leaves
     * the plan and every agent standing and the archive refused as not
     * ready, so it is asked again a moment later.
     */
    update: plans.update.effect(function* ({ input, context }) {
      const { userId, request } = context;
      const taskId = yield* pathUuid(input.params.id);
      const changes = input.body;
      const organizationId =
        changes.workspaceId === undefined
          ? undefined
          : yield* movedToWorkspace(
              userId,
              yield* reachedTask(userId, taskId),
              changes.workspaceId,
            );
      const workspace =
        organizationId === undefined
          ? Effect.map(reachedTask(userId, taskId), (stored) => stored.workspaceId)
          : Effect.succeed(organizationId);
      // Note that a teammate names a repository on the App alone, never their own token, because a task on a token is its owner's.
      const reached =
        "repository" in changes
          ? yield* reachableRepository(
              workspace,
              changes.repository,
              (yield* reachedTask(userId, taskId)).ownerId === userId ? userId : undefined,
            )
          : undefined;
      // An assignee is confirmed a member before anything is stopped, since a Stop is not taken
      // back by a write refused after it; the store confirms it again under the row's lock.
      const { assigneeId } = changes;
      if (assigneeId !== undefined && assigneeId !== null) {
        const member = yield* hostedStoreOrUnavailable(
          isWorkspaceMember(assigneeId, yield* workspace),
        );
        if (!member) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      }
      // Where its agents run is set at creation, so a change that names another place is refused before anything is stopped.
      yield* runsOnChange(userId, taskId, changes.runsOn);
      // A merge policy and the running switch are a pilot tree's, set on its top task alone, whose children follow it.
      if (changes.mergePolicy !== undefined || changes.running !== undefined) {
        yield* topPilotTask(yield* reachedTask(userId, taskId));
      }
      // A repository another than its tree's is refused before anything is stopped too; the store holds it again under the lock.
      // Note that the name GitHub resolved is asked, not the one typed, so a renamed repository's old name is the one held.
      if (reached !== undefined) {
        yield* checkTreeRepository(userId, taskId, reached.repository).pipe(
          Effect.catch((failure) =>
            failure._tag === "TaskTreeRepositoryLocked"
              ? Effect.fail(HOSTED_REFUSAL.CHILD_REPOSITORY_LOCKED)
              : hostedStoreOrUnavailable(Effect.fail(failure)),
          ),
        );
      }
      const archiving = changes.archived === true;
      if (archiving) {
        const agents = yield* hostedStoreOrUnavailable(listAgents(userId, taskId));
        // Every agent is read before any is stopped, so an archive refused as not ready cancels no one's work.
        if (!(yield* everyStopsForGood(agents))) {
          return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
        }
        yield* everyStoppedForGood(seams, writer, request, userId, agents);
      }
      // Note that the archive stamp is never written, because a task is archived no longer: the request settles the task, or puts it back to work.
      const status =
        changes.status !== undefined || changes.archived === undefined
          ? changes.status
          : yield* hostedStoreOrUnavailable(
              archiveAskedStatus(
                userId,
                taskId,
                (yield* reachedTask(userId, taskId)).status,
                changes.archived,
              ),
            );
      const task = yield* updateTaskCommitted(
        userId,
        taskId,
        {
          ...("name" in changes ? { name: changes.name } : undefined),
          ...(organizationId === undefined ? undefined : { organizationId }),
          ...(reached === undefined
            ? undefined
            : { repository: reached.repository, githubAccess: reached.githubAccess }),
          ...("pinned" in changes ? { pinned: changes.pinned } : undefined),
          ...("pinPosition" in changes ? { pinPosition: changes.pinPosition } : undefined),
          ...(status === undefined ? undefined : { status }),
          ...(changes.priority === undefined ? undefined : { priority: changes.priority }),
          ...(changes.assigneeId === undefined ? undefined : { assigneeId: changes.assigneeId }),
          ...(changes.mergePolicy === undefined ? undefined : { mergePolicy: changes.mergePolicy }),
          ...(changes.running === undefined ? undefined : { running: changes.running }),
        },
        organizationId === undefined ? undefined : movedRepositoryReached(organizationId, userId),
      ).pipe(
        Effect.catch((failure) =>
          failure._tag === "MoveRefused"
            ? Effect.fail(failure.refusal)
            : failure._tag === "TaskAssigneeNotMember"
              ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)
              : failure._tag === "TaskTreeRepositoryLocked"
                ? Effect.fail(HOSTED_REFUSAL.CHILD_REPOSITORY_LOCKED)
                : hostedStoreOrUnavailable(Effect.fail(failure)),
        ),
      );
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const { task: plan, txid, mergePolicyMoved, runningMoved } = task.value;
      // The pilot is told only of a switch that moved under the row's lock, so a repeat of the same switch wakes no one.
      if (mergePolicyMoved) yield* tellPilotOfMergePolicy(seams, request, writer, userId, taskId);
      if (runningMoved) yield* tellPilotOfRunning(seams, request, writer, userId, taskId);
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
      const opened = yield* hostedStoreOrUnavailable(readTaskPlan(userId, taskId));
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
     * The Stops and the retires reach eve as the request's own caller
     * (`coder-host/stop.ts`'s `eveFor`): over the developer's bearer, or, for
     * a browser's session cookie, as the deployment acting for the account
     * the cookie named, which eve's door admits for a cancel and a retire on
     * a session that account reaches. A cookie's delete on a deployment that
     * cannot reach eve as itself is refused as unavailable before anything is
     * stopped (`retiringReach`), where a bearer's goes on with its retires a
     * courtesy.
     */
    delete: plans.delete.effect(function* ({ input, context }) {
      const { userId, request } = context;
      const taskId = yield* pathUuid(input.id);
      const eveAt = yield* retiringReach(seams, request, userId);
      const agents = yield* hostedStoreOrUnavailable(
        listAgents(userId, taskId, { includeArchived: true }),
      );
      yield* everyStoppedForGood(seams, writer, request, userId, agents);
      // The stopped agents' sessions are retired before the delete's transaction, so no lock waits on eve;
      // an agent started meanwhile is none of these, keeps its session, and refuses the delete below.
      yield* hostedStoreOrUnavailable(
        retiredBeforeDelete(eveAt)(agents.map(({ conversationId }) => conversationId)),
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
     * saved, with the text as it now stands and who last wrote it where the
     * edit conflicts with it, or as refused where the plan would be longer than a plan may be.
     */
    edit: plans.edit.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.params.id);
      const saved = yield* saveDeveloperEdit({ userId: context.userId, taskId }, input.body);
      switch (saved.status) {
        case PLAN_SAVE_STATUS.SAVED:
          return { plan: saved.task };
        case PLAN_SAVE_STATUS.CONFLICT:
          return {
            conflict:
              saved.by === undefined
                ? { current: saved.current }
                : { current: saved.current, by: saved.by },
          };
        case PLAN_SAVE_STATUS.NOT_SAVED:
          if (saved.reason === PLAN_SAVE_REFUSAL.TOO_LONG) {
            return { refused: PLAN_EDIT_REFUSAL.TOO_LONG };
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
      if (restored.status !== PLAN_SAVE_STATUS.SAVED) {
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
