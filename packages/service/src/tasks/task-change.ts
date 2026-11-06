import type { DatabaseServices } from "@repo/database/core/query";
import { listAgents } from "@repo/database/models/agent-store";
import {
  checkTreeRepository,
  readTaskHeader,
  type TaskChanged,
  type TaskChanges,
  updateTaskCommitted,
} from "@repo/database/models/task-store";
import { isWorkspaceMember } from "@repo/database/models/workspace-store";
import { storeWriter } from "@repo/database/models/writer";
import type { StoredArchive } from "@repo/database/schemas/agent";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { TASK_STATUS, type TaskUpdateRequest } from "@repo/features/task-wire";
import { Data, Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import {
  everyStoppedForGood,
  everyStopsForGood,
  idleStandingAgents,
} from "../agents/coder-host/stop.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { type SandboxStopReach, stoppedInBackground } from "../agents/session-sandboxes.js";
import { recordServerEvent, SERVER_EVENT, SERVER_TASK_FINISHER } from "../events/server-events.js";
import type { GitHubApp } from "../github/github-app.js";
import { workspaceRepository } from "../github/workspace-repository.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { archiveAskedStatus } from "./archive-settle.js";

const STOPPER = storeWriter({ tools: CODER_TOOL_SET });

export type TaskChangeRequest = Omit<TaskUpdateRequest, "runsOn">;

class MoveRefused extends Data.TaggedError("MoveRefused")<{ readonly refusal: HostedRefusal }> {}

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

export interface TaskChangeConfirmed {
  readonly changes: TaskChanges;
  readonly moveGuard: ReturnType<typeof movedRepositoryReached> | undefined;
}

export const taskChangeAsked = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  taskId: string,
  asked: TaskChangeRequest,
  caller?: string,
): Effect.fn.Return<
  TaskChangeConfirmed,
  HostedRefusal,
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  const header = yield* hostedStoreOrUnavailable(readTaskHeader(userId, taskId));
  if (Option.isNone(header)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { ownerId, status: standing } = header.value;
  const organizationId = asked.workspaceId;
  if (organizationId !== undefined) {
    if (ownerId !== userId) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
    const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, organizationId));
    if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  const workspaceId = organizationId ?? header.value.workspaceId;
  const reached =
    asked.repository === undefined
      ? undefined
      : asked.repository === null
        ? { repository: null, githubAccess: GITHUB_ACCESS.APP }
        : yield* Effect.map(
            workspaceRepository(
              workspaceId,
              asked.repository,
              ownerId === userId ? userId : undefined,
            ),
            (each) => ({ repository: each.repository.fullName, githubAccess: each.access }),
          );
  const { assigneeId } = asked;
  if (assigneeId !== undefined && assigneeId !== null) {
    const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(assigneeId, workspaceId));
    if (!member) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  if (reached !== undefined) {
    yield* checkTreeRepository(userId, taskId, reached.repository).pipe(
      Effect.catch((failure) =>
        failure._tag === "TaskTreeRepositoryLocked"
          ? Effect.fail(HOSTED_REFUSAL.CHILD_REPOSITORY_LOCKED)
          : hostedStoreOrUnavailable(Effect.fail(failure)),
      ),
    );
  }
  if (asked.archived === true) {
    const listed = yield* hostedStoreOrUnavailable(listAgents(userId, taskId));
    const agents = listed.filter((agent) => agent.id !== caller);
    if (!(yield* everyStopsForGood(agents))) {
      return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
    }
    yield* everyStoppedForGood(STOPPER, userId, agents);
  }
  const status =
    asked.status !== undefined || asked.archived === undefined
      ? asked.status
      : yield* hostedStoreOrUnavailable(
          archiveAskedStatus(userId, taskId, standing ?? TASK_STATUS.TODO, asked.archived),
        );
  return {
    changes: {
      ...(asked.name === undefined ? undefined : { name: asked.name }),
      ...(organizationId === undefined ? undefined : { organizationId }),
      ...reached,
      ...(asked.pinned === undefined ? undefined : { pinned: asked.pinned }),
      ...(asked.pinPosition === undefined ? undefined : { pinPosition: asked.pinPosition }),
      ...(asked.readMark === undefined ? undefined : { readMark: asked.readMark }),
      ...(status === undefined ? undefined : { status }),
      ...(asked.priority === undefined ? undefined : { priority: asked.priority }),
      ...(assigneeId === undefined ? undefined : { assigneeId }),
    },
    moveGuard:
      organizationId === undefined ? undefined : movedRepositoryReached(organizationId, userId),
  };
});

export const taskChangeWritten = (
  userId: string,
  taskId: string,
  { changes, moveGuard }: TaskChangeConfirmed,
  archivedBy: StoredArchive,
) =>
  updateTaskCommitted(userId, taskId, changes, moveGuard, {
    archivedBy,
    idle: idleStandingAgents,
  }).pipe(
    Effect.catch((failure) => {
      switch (failure._tag) {
        case "MoveRefused":
          return Effect.fail(failure.refusal);
        case "TaskAssigneeNotMember":
          return Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
        case "TaskTreeRepositoryLocked":
          return Effect.fail(HOSTED_REFUSAL.CHILD_REPOSITORY_LOCKED);
        default:
          return hostedStoreOrUnavailable(Effect.fail(failure));
      }
    }),
  );

export const taskChangeSettled = /* @__PURE__ */ Effect.fnUntraced(function* (
  reach: SandboxStopReach,
  userId: string,
  { task, archived, statusMoved }: TaskChanged,
) {
  if (archived.length > 0) yield* stoppedInBackground(reach, archived);
  if (statusMoved && (task.status === TASK_STATUS.DONE || task.status === TASK_STATUS.CANCELED)) {
    yield* recordServerEvent(
      SERVER_EVENT.TASK_FINISH,
      { userId, workspaceId: task.workspaceId },
      { status: task.status, by: SERVER_TASK_FINISHER.MEMBER },
    );
  }
});
