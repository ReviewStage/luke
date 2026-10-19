/**
 * tasks-procedures.ts -- the account's plans: list, start, open, change, and delete, and each one's board, edit, history, transcript, work, and Luke's Stop.
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
 * the plan, as its archive stops them before it archives them with the plan.
 * Each row of the list carries what the plan's coding agents are doing and
 * what they published, in brief, where it has any
 * (`packages/service/src/agents/task-agents.ts`). A pin and an archive are
 * changes like a rename, though a pin is the asking member's own and reads
 * pinned for no one else, and the list leaves the archived plans out unless
 * `archived=include` asks for them, so a build from before archiving, which
 * never asks, draws none of them rather than all of them.
 *
 * `/api/plans/{id}/board` is the plan's whiteboard: the Mac reads it, with
 * Luke's latest drawing, and writes the scene back whole, the last write
 * winning (`@luke/database/models/board-store`). `/api/plans/{id}/transcript`
 * is what was said on the plan's calls, read and never written here
 * (`@luke/database/models/transcript-store`). `/api/plans/{id}/work` is what
 * Luke's brain wrote and ran on them, a page at a time, and every code he
 * showed (`tasks/task-work-store.ts`). `/api/plans/{id}/revisions` is the
 * plan's history for the History tab, a page at a time;
 * `/api/plans/{id}/revisions/{seq}` one revision's content beside the one
 * before it; and `/api/plans/{id}/revisions/{seq}/restore` puts that content
 * back as a revision of the developer's (`@luke/database/models/plan-revisions`).
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
import { askRecord } from "@luke/database/models/asks";
import { readBoard, writeScene } from "@luke/database/models/board-store";
import { listCodingAgents, readCodingAgentByKey } from "@luke/database/models/coding-agent-store";
import { hostedStore } from "@luke/database/models/hosted-store";
import { readIssue } from "@luke/database/models/issue-store";
import { listRevisions, readRevision } from "@luke/database/models/plan-revisions";
import { conversationOwnerOf, standingSessionsNamed } from "@luke/database/models/recorded-session";
import {
  createTask,
  deleteTask,
  listTasks,
  readTask,
  type StoredTask,
  updateTask,
} from "@luke/database/models/task-store";
import { readTranscript } from "@luke/database/models/transcript-store";
import type { WorkspaceSeams } from "@luke/database/models/workspace-seams";
import { ensurePersonalWorkspace, isWorkspaceMember } from "@luke/database/models/workspace-store";
import { type StoreWriter, storeWriter } from "@luke/database/models/writer";
import { BOARD_BOUNDS } from "@luke/features/board-wire";
import { TASK_START_STATUS } from "@luke/features/contract";
import { PLAN_EDIT_REFUSAL } from "@luke/features/plan-edit";
import {
  TASK_BOUNDS,
  type Task,
  type TaskAgentStart,
  type TaskStartAnswer,
} from "@luke/features/task-wire";
import { readEither } from "@luke/wire/effect";
import { Data, Effect, Option, Result } from "effect";
import type { HttpClient } from "effect/http";
import { STOP_REFUSAL, stopConversation } from "../agents/brain-host/brain-ask.js";
import { EVE_MOUNT } from "../agents/brain-host/eve-sessions.js";
import { MAXIMUM_START_BODY_BYTES, startRequestedAgent } from "../agents/coder-host/start.js";
import {
  type EveReach,
  eveFor,
  standsStopped,
  stoppedForGood,
  stopsForGood,
  summaryOf,
} from "../agents/coder-host/stop.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { retireSessions, retiringReach } from "../agents/retire-sessions.js";
import { listTasklessAgents, withTaskAgents } from "../agents/task-agents.js";
import { TASK_LIST_ARCHIVED, unparsedWire, wireUuidSchema } from "../core.js";
import { recordServerEvent, SERVER_EVENT, SERVER_TASK_SOURCE } from "../events/server-events.js";
import type { GitHubApp } from "../github/github-app.js";
import { workspaceRepository } from "../github/workspace-repository.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrArchived,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";
import {
  linearIssue,
  linearOrRefused,
  throughWorkspaceLinear,
} from "../integrations/linear-issues.js";
import { accountMiddleware, bodyLimit, hosted } from "../orpc/base.js";
import {
  PLAN_SAVE_REFUSAL,
  PLAN_SAVE_STATUS,
  restoreRevision,
  saveDeveloperEdit,
} from "./plan-notes.js";
import { readTaskWork } from "./task-work-store.js";

/** A change is a name and a repository's name at most, so a body past this is none. */
const MAXIMUM_NAME_BODY_BYTES = 8_192;

/** A brief at its bound with every character escaped. */
const MAXIMUM_BRIEF_BYTES = TASK_BOUNDS.MAX_BRIEF_CHARS * 6;

/** A start is a change's few fields, a brief where it names one, and an agent's Start beside them where it names one. */
const MAXIMUM_TASK_START_BODY_BYTES =
  MAXIMUM_NAME_BODY_BYTES + MAXIMUM_BRIEF_BYTES + MAXIMUM_START_BODY_BYTES;

/** An edit is the plan's text twice, its base and its value, each at its bound with every character escaped. */
const MAXIMUM_EDIT_BODY_BYTES = TASK_BOUNDS.MAX_BODY_CHARS * 2 * 6 + 1_024;

/** A save is a scene at its byte bound and its image at its own, with room for the drawing's number around them. */
const MAXIMUM_BOARD_BODY_BYTES = BOARD_BOUNDS.MAX_BYTES + BOARD_BOUNDS.MAX_IMAGE_CHARS + 1_024;

export interface TasksProcedureSeams extends EveReach {
  resolveUserId: UserIdResolver;
  /** The plugin's write that makes an account's first workspace, the first time a start needs it. */
  workspaces: WorkspaceSeams;
}

/** The plan a path names: an id that is no UUID names no row, and answers as none. */
const taskIdOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  id: string,
): Effect.fn.Return<string, HostedRefusal> {
  const read = readEither(wireUuidSchema)(unparsedWire(id));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

/**
 * The repository as the row keeps it: null where none was named, or the
 * full name as GitHub spells it once the App confirms the workspace's
 * installation reaches it (`packages/service/src/github/workspace-repository.ts`). The workspace
 * is read only where a repository is named.
 */
const reachableRepository = /* @__PURE__ */ Effect.fnUntraced(function* (
  workspace: Effect.Effect<string, HostedRefusal, DatabaseServices>,
  repository: string | null | undefined,
): Effect.fn.Return<
  string | null,
  HostedRefusal,
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  if (repository === undefined || repository === null) return null;
  const organizationId = yield* workspace;
  const reached = yield* workspaceRepository(organizationId, repository);
  return reached.fullName;
});

/** The account's plan, or not found for a plan it does not reach. */
const reachedTask = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  taskId: string,
): Effect.fn.Return<StoredTask, HostedRefusal, DatabaseServices> {
  const opened = yield* hostedStoreOrUnavailable(readTask(userId, taskId));
  if (Option.isNone(opened)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return opened.value;
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
  stored: StoredTask,
  workspaceId: string,
): Effect.fn.Return<string, HostedRefusal, DatabaseServices> {
  if (stored.ownerId !== userId) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, workspaceId));
  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return workspaceId;
});

/** The move's guard: the workspace's GitHub reaches the repository the plan names under its lock, where it names one. */
const movedRepositoryReached =
  (workspaceId: string) =>
  (
    repository: string | null,
  ): Effect.Effect<void, MoveRefused, GitHubApp | HttpClient.HttpClient | DatabaseServices> =>
    repository === null
      ? Effect.void
      : workspaceRepository(workspaceId, repository).pipe(
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
 * The Linear issue a plan starts from, as the task links it, read through
 * the workspace's own Linear connection whatever team it is in, or the
 * Linear refusal: the workspace has none connected, its grant is refused,
 * or the issue is none it reaches. Nothing is written before it is read, so
 * a refusal starts no plan.
 */
const startingLinearIssue = (organizationId: string, issueId: string) =>
  linearOrRefused(
    throughWorkspaceLinear(organizationId, (token) => linearIssue(token, issueId)),
    "Linear gave no issue to start a task from",
  );

/**
 * The workspace's own issue a plan starts from, where the account reads it
 * and it is an issue of the workspace the plan starts in; refused as not
 * found otherwise, before anything is written.
 */
const startingIssue = Effect.fnUntraced(function* (
  userId: string,
  organizationId: string,
  issueId: string,
) {
  const read = yield* hostedStoreOrUnavailable(readIssue(userId, issueId));
  if (Option.isNone(read) || read.value.workspaceId !== organizationId) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  return read.value.id;
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
  const made = yield* hostedStoreOrUnavailable(readCodingAgentByKey(userId, idempotencyKey));
  if (Option.isNone(made)) return Option.none();
  const task =
    made.value.taskId === null
      ? Option.none()
      : yield* hostedStoreOrUnavailable(readTask(userId, made.value.taskId));
  if (Option.isNone(task) || task.value.task.workspaceId !== organizationId) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return Option.some({ plan: task.value.task, agent: yield* summaryOf(userId, made.value) });
});

/**
 * The agent the key names on the plan, where the Start made one before it
 * failed: a store write or read after eve took the session failed the
 * Start, though the agent works on. Nothing where it made none, or where it
 * could not be read either.
 */
const agentMadeOn = (userId: string, taskId: string, idempotencyKey: string) =>
  Effect.gen(function* () {
    const made = yield* readCodingAgentByKey(userId, idempotencyKey);
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
  readTask(userId, task.id).pipe(
    Effect.map((read) => Option.match(read, { onNone: () => task, onSome: (now) => now.task })),
    Effect.catch((failure) => Effect.as(logStoreFailure(failure), task)),
  );

const startedAgentOn = (
  seams: TasksProcedureSeams,
  request: Request,
  userId: string,
  task: Task,
  agent: TaskAgentStart,
) =>
  startRequestedAgent(eveFor(seams, request, userId), userId, task.id, agent).pipe(
    Effect.flatMap((started) =>
      Effect.map(
        taskAfterStart(userId, task),
        (plan): TaskStartAnswer => ({ plan, agent: started.agent }),
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
        return { plan: task, agentRefusal: { error: refusal.error } } satisfies TaskStartAnswer;
      }),
    ),
  );

/** What a restore that saved nothing answers, by why; the store out of reach is any other. */
const RESTORE_REFUSAL: ReadonlyMap<string, HostedRefusal> = new Map<string, HostedRefusal>([
  [PLAN_SAVE_REFUSAL.NO_TASK, HOSTED_REFUSAL.NOT_FOUND],
  [PLAN_SAVE_REFUSAL.NO_REVISION, HOSTED_REFUSAL.NOT_FOUND],
  [PLAN_SAVE_REFUSAL.TOO_LONG, HOSTED_REFUSAL.REQUEST_TOO_LARGE],
  [PLAN_SAVE_REFUSAL.ARCHIVED, HOSTED_REFUSAL.TASK_ARCHIVED],
]);

/** What an edit that saved nothing answers, by why, where it is not answered in band; the store out of reach is any other. */
const EDIT_REFUSAL: ReadonlyMap<string, HostedRefusal> = new Map<string, HostedRefusal>([
  [PLAN_SAVE_REFUSAL.NO_TASK, HOSTED_REFUSAL.NOT_FOUND],
  [PLAN_SAVE_REFUSAL.ARCHIVED, HOSTED_REFUSAL.TASK_ARCHIVED],
]);

/** The plans resource, every procedure to a signed-in caller. */
export function tasksProcedures(seams: TasksProcedureSeams) {
  const writer: Effect.Effect<StoreWriter> = storeWriter({ tools: CODER_TOOL_SET });
  const plans = hosted.plans.use(accountMiddleware(seams.resolveUserId));
  return {
    /** The account's plans, and beside them the agents with no plan in its workspaces. */
    list: plans.list.effect(function* ({ input, context }) {
      const includeArchived = input.archived === TASK_LIST_ARCHIVED.INCLUDE;
      const tasks = yield* hostedStoreOrUnavailable(
        Effect.flatMap(listTasks(context.userId, { includeArchived }), (listed) =>
          withTaskAgents(context.userId, listed),
        ),
      );
      const tasklessAgents = yield* hostedStoreOrUnavailable(
        listTasklessAgents(context.userId, { includeArchived }),
      );
      return { plans: tasks, planlessAgents: tasklessAgents };
    }),

    /**
     * A plan started with an empty document, its repository confirmed and
     * its Linear issue and its own issue read first, and, where it names an
     * agent, that agent started on it: a start naming an agent and no
     * repository is refused as an agent's Start on such a plan is, before
     * anything is written, and the agent's session is opened as the
     * request's own caller (`coder-host/stop.ts`'s `eveFor`); one whose
     * agent's key already started an agent in the workspace answers that
     * agent's plan and the agent (`startedBefore`).
     */
    create: plans.create.use(bodyLimit(MAXIMUM_TASK_START_BODY_BYTES)).effect(function* ({
      input,
      context,
    }) {
      const { userId, request } = context;
      const { agent } = input;
      if (agent !== undefined && (input.repository === undefined || input.repository === null)) {
        return yield* Effect.fail(HOSTED_REFUSAL.NO_REPOSITORY);
      }
      const organizationId = yield* startingWorkspace(seams, userId, input.workspaceId);
      const before =
        agent === undefined
          ? Option.none()
          : yield* startedBefore(userId, agent.idempotencyKey, organizationId);
      if (Option.isSome(before)) return { status: TASK_START_STATUS.RETRIED, body: before.value };
      const repository = yield* reachableRepository(
        Effect.succeed(organizationId),
        input.repository,
      );
      const issue =
        input.linearIssueId === undefined
          ? undefined
          : yield* startingLinearIssue(organizationId, input.linearIssueId);
      const issueId =
        input.issueId === undefined
          ? undefined
          : yield* startingIssue(userId, organizationId, input.issueId);
      // An agent is the start, so its plan opens with no planning phase.
      const planning = agent === undefined ? input.planning : false;
      const task = yield* hostedStoreOrUnavailable(
        createTask(userId, {
          organizationId,
          ...(input.name === undefined ? undefined : { name: input.name }),
          repository,
          ...(issue === undefined ? undefined : { issueLinks: [issue] }),
          ...(issueId === undefined ? undefined : { issueId }),
          ...(planning === undefined ? undefined : { planning }),
          ...(input.brief === undefined ? undefined : { brief: input.brief }),
          ...(input.status === undefined ? undefined : { status: input.status }),
          ...(input.priority === undefined ? undefined : { priority: input.priority }),
        }),
      );
      yield* recordServerEvent(SERVER_EVENT.TASK_CREATE, userId, {
        source: SERVER_TASK_SOURCE.SIDEBAR,
        has_issue: issue !== undefined || issueId !== undefined,
      });
      const answer: TaskStartAnswer =
        agent === undefined
          ? { plan: task }
          : yield* startedAgentOn(seams, request, userId, task, agent);
      return { status: TASK_START_STATUS.CREATED, body: answer };
    }),

    /** One plan with its saved document. */
    open: plans.open.effect(function* ({ input, context }) {
      const taskId = yield* taskIdOf(input.id);
      const opened = yield* reachedTask(context.userId, taskId);
      return { plan: opened.task };
    }),

    /**
     * The plan's name, its repository, its pin, its archive, its workspace,
     * or any of them changed, answered with its document. A repository and a
     * move are confirmed before the row is touched, so a refused one leaves
     * the rest unchanged too; a repository named beside a move is confirmed
     * in the workspace the plan moves to, and a move confirms the repository
     * the row names under its lock, so one changed meanwhile is the one
     * confirmed.
     *
     * An archive stops every coding agent of the plan first, as a Stop and
     * an agent's own archive stop one, then archives them with the plan
     * under its lock (`updateTask`), each read again under its
     * conversation's lock. An eve that refuses a Stop, an agent still coming
     * up or with a message awaiting its turn, which no Stop can name yet, or
     * one handed a message after it was stopped, leaves the plan and every
     * agent standing and the archive refused as not ready, so it is asked
     * again a moment later.
     */
    update: plans.update.use(bodyLimit(MAXIMUM_NAME_BODY_BYTES)).effect(function* ({
      input,
      context,
    }) {
      const { userId, request } = context;
      const taskId = yield* taskIdOf(input.params.id);
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
          ? Effect.map(reachedTask(userId, taskId), (stored) => stored.task.workspaceId)
          : Effect.succeed(organizationId);
      const repository =
        "repository" in changes
          ? yield* reachableRepository(workspace, changes.repository)
          : undefined;
      const archiving = changes.archived === true;
      if (archiving) {
        const agents = yield* hostedStoreOrUnavailable(listCodingAgents(userId, taskId));
        // Every agent is read before any is stopped, so an archive refused as not ready cancels no one's work.
        const ready = yield* Effect.forEach(agents, stopsForGood);
        if (ready.includes(false)) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
        yield* Effect.forEach(
          agents,
          (agent) => stoppedForGood(seams, writer, request, userId, agent),
          { discard: true },
        );
      }
      const task = yield* updateTask(
        userId,
        taskId,
        {
          ...("name" in changes ? { name: changes.name } : undefined),
          ...(organizationId === undefined ? undefined : { organizationId }),
          ...(repository === undefined ? undefined : { repository }),
          ...("pinned" in changes ? { pinned: changes.pinned } : undefined),
          ...("pinPosition" in changes ? { pinPosition: changes.pinPosition } : undefined),
          ...("archived" in changes ? { archived: changes.archived } : undefined),
          ...(changes.status === undefined ? undefined : { status: changes.status }),
          ...(changes.priority === undefined ? undefined : { priority: changes.priority }),
        },
        organizationId === undefined ? undefined : movedRepositoryReached(organizationId),
        archiving ? standsStopped : undefined,
      ).pipe(
        Effect.catch((failure) =>
          failure._tag === "MoveRefused"
            ? Effect.fail(failure.refusal)
            : failure._tag === "TaskAgentUnstopped"
              ? Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY)
              : hostedStoreOrArchived(Effect.fail(failure)),
        ),
      );
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { plan: task.value };
    }),

    /**
     * Every coding agent of the plan stopped for good first, as a Stop and an
     * archive stop one, so none works on for a plan that is gone; then the
     * plan's eve sessions and its agents' retired (`retire-sessions.ts`);
     * then the plan. An eve that refuses a Stop, an agent with a turn still
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
      const taskId = yield* taskIdOf(input.id);
      const eveAt = yield* retiringReach(seams, request, userId);
      const agents = yield* hostedStoreOrUnavailable(
        listCodingAgents(userId, taskId, { includeArchived: true }),
      );
      yield* Effect.forEach(
        agents,
        (agent) => stoppedForGood(seams, writer, request, userId, agent),
        { discard: true },
      );
      const stopped = new Set(agents.map(({ id }) => id));
      const deleted = yield* hostedStoreOrUnavailable(
        deleteTask(userId, taskId, {
          stoppedAgentIds: stopped,
          // Note that the sessions are retired under the plan's lock and before its conversations are
          // cleared: eve's door admits no one to a cleared conversation's session, and a delete an
          // agent started meanwhile refuses retires nothing.
          beforeDelete: (conversationIds) =>
            Effect.flatMap(standingSessionsNamed(conversationIds), (sessions) =>
              retireSessions(eveAt, sessions),
            ),
        }).pipe(Effect.catchTag("TaskAgentUnstopped", () => Effect.succeed(undefined))),
      );
      // An agent started while the others were stopped is one this delete has not stopped yet.
      if (deleted === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
      if (!deleted) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { deleted: true as const };
    }),

    /** The plan's board, with Luke's latest drawing. */
    readBoard: plans.readBoard.effect(function* ({ input, context }) {
      const taskId = yield* taskIdOf(input.id);
      const board = yield* hostedStoreOrUnavailable(readBoard(context.userId, taskId));
      if (Option.isNone(board)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { board: board.value };
    }),

    /** The Mac's scene written whole, the last write winning. */
    saveBoard: plans.saveBoard.use(bodyLimit(MAXIMUM_BOARD_BODY_BYTES)).effect(function* ({
      input,
      context,
    }) {
      const taskId = yield* taskIdOf(input.params.id);
      const save = input.body;
      const written = yield* hostedStoreOrArchived(
        writeScene(context.userId, taskId, save.elements, save.appliedDrawing, save.image),
      );
      if (Option.isNone(written)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { board: written.value };
    }),

    /**
     * The developer's edit of the plan's document: answered with the plan as
     * saved, with the text as it now stands where the edit conflicts with
     * it, or as refused where the plan would be longer than a plan may be.
     * An archived plan is refused outright, as no plan is, since a desktop
     * that knows archiving draws no editor on one.
     */
    edit: plans.edit.use(bodyLimit(MAXIMUM_EDIT_BODY_BYTES)).effect(function* ({ input, context }) {
      const taskId = yield* taskIdOf(input.params.id);
      const saved = yield* saveDeveloperEdit({ userId: context.userId, taskId }, input.body);
      switch (saved.status) {
        case PLAN_SAVE_STATUS.SAVED:
          return { plan: saved.task };
        case PLAN_SAVE_STATUS.CONFLICT:
          return { conflict: { current: saved.current } };
        case PLAN_SAVE_STATUS.NOT_SAVED:
          if (saved.reason === PLAN_SAVE_REFUSAL.TOO_LONG) {
            return { refused: PLAN_EDIT_REFUSAL.TOO_LONG };
          }
          return yield* Effect.fail(EDIT_REFUSAL.get(saved.reason) ?? HOSTED_REFUSAL.UNAVAILABLE);
      }
    }),

    /** What was said on the plan's calls. */
    transcript: plans.transcript.effect(function* ({ input, context }) {
      const taskId = yield* taskIdOf(input.id);
      const transcript = yield* hostedStoreOrUnavailable(readTranscript(context.userId, taskId));
      if (Option.isNone(transcript)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { transcript: transcript.value };
    }),

    /** A page of the plan's work, and on the newest page every code shown on it. */
    work: plans.work.effect(function* ({ input, context }) {
      const taskId = yield* taskIdOf(input.id);
      const work = yield* hostedStoreOrUnavailable(
        readTaskWork(context.userId, taskId, input.before),
      );
      if (Option.isNone(work)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return work.value;
    }),

    /**
     * A page of the plan's history, the newest first. A plan with no history
     * yet answers an empty page, and so does a plan id the account does not
     * own, as `readTranscript` answers neither apart.
     */
    revisions: plans.revisions.effect(function* ({ input, context }) {
      const taskId = yield* taskIdOf(input.id);
      return yield* hostedStoreOrUnavailable(listRevisions(context.userId, taskId, input.before));
    }),

    /** One revision's content and the content before it. */
    revision: plans.revision.effect(function* ({ input, context }) {
      const taskId = yield* taskIdOf(input.id);
      const revision = yield* hostedStoreOrUnavailable(
        readRevision(context.userId, taskId, input.seq),
      );
      if (Option.isNone(revision)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { revision: revision.value };
    }),

    /**
     * One revision's content put back as the plan's, a revision of the
     * developer's naming it, answered with the plan as it now stands. It
     * names nothing in a body: the plan and the revision are the path's.
     */
    restore: plans.restore.effect(function* ({ input, context }) {
      const taskId = yield* taskIdOf(input.id);
      const restored = yield* restoreRevision({ userId: context.userId, taskId }, input.seq);
      if (restored.status !== PLAN_SAVE_STATUS.SAVED) {
        return yield* Effect.fail(
          RESTORE_REFUSAL.get(restored.reason) ?? HOSTED_REFUSAL.UNAVAILABLE,
        );
      }
      return { plan: restored.task };
    }),

    /** The turn Luke is running on the plan stopped, call or no call, under its conversation's owner, through eve as the request's own caller (`eveFor`). */
    stop: plans.stop.effect(function* ({ input, context }) {
      const { userId, request } = context;
      const taskId = yield* taskIdOf(input.id);
      const { conversationId } = yield* reachedTask(userId, taskId);
      const owner = Option.getOrUndefined(
        conversationId === undefined
          ? Option.none()
          : yield* hostedStoreOrUnavailable(conversationOwnerOf(conversationId)),
      );
      if (conversationId === undefined || owner === undefined) return {};
      const eve = yield* eveFor(seams, request, userId, EVE_MOUNT.TASKS);
      const stopSeams = { store: hostedStore(), asks: askRecord(), writer: yield* writer, eve };
      const stopped = yield* hostedStoreOrUnavailable(
        stopConversation(stopSeams, owner, conversationId),
      );
      const refused =
        stopped !== undefined &&
        Result.isFailure(stopped) &&
        stopped.failure.refusal === STOP_REFUSAL.UPSTREAM;
      if (refused) return yield* Effect.fail(HOSTED_REFUSAL.UPSTREAM_ERROR);
      return {};
    }),
  };
}
