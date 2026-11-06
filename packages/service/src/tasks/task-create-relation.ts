import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { recordRevision } from "@repo/database/models/description-revisions";
import {
  addTaskBlock,
  lockTasksForBlocks,
  type TaskBlockAcrossWorkspaces,
  type TaskBlockCycle,
  type TaskBlockPair,
  type TaskBlockSelf,
} from "@repo/database/models/task-block-store";
import {
  createTaskCommitted,
  createTaskCommittedOnce,
  type NewTask,
  readTask,
  readTaskHeader,
  setTaskParent,
  type TaskAssigneeNotMember,
  type TaskIdTaken,
  type TaskParentCycle,
  TaskParentRepositoryDiffers,
  type TaskParentUnreached,
  type TaskStartCommitted,
} from "@repo/database/models/task-store";
import { GITHUB_ACCESS, type GitHubAccess } from "@repo/features/github-repositories-wire";
import {
  TASK_CREATE_RELATION_KIND,
  type TaskBlockRelation,
  type TaskCreateRelation,
} from "@repo/features/task-wire";
import { Data, Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import { SqlClient } from "effect/sql";
import {
  recordServerEvent,
  SERVER_EVENT,
  type SERVER_TASK_SOURCE,
} from "../events/server-events.js";
import type { GitHubApp } from "../github/github-app.js";
import { workspaceRepository } from "../github/workspace-repository.js";
import type { HostedRefusal } from "../http/http-effect.js";
import { taskParentOf } from "./task-parent.js";

class TaskRelationUnreached extends Data.TaggedError("TaskRelationUnreached") {}

class TaskParentHeld extends Data.TaggedError("TaskParentHeld") {}

export type TaskCreateRelationRefused =
  | TaskRelationUnreached
  | TaskParentHeld
  | TaskParentUnreached
  | TaskParentRepositoryDiffers
  | TaskParentCycle
  | TaskBlockSelf
  | TaskBlockAcrossWorkspaces
  | TaskBlockCycle;

export type TaskCreateRelationAsked =
  | {
      readonly kind: typeof TASK_CREATE_RELATION_KIND.PARENT_OF;
      readonly taskId: string;
      readonly repository: string | null;
    }
  | { readonly kind: TaskBlockRelation; readonly taskId: string };

function sameRepository(asked: string | null, held: string | null): boolean {
  if (asked === null || held === null) return asked === held;
  return asked.toLowerCase() === held.toLowerCase();
}

function blockPairOf(taskId: string, otherId: string, kind: TaskBlockRelation): TaskBlockPair {
  return kind === TASK_CREATE_RELATION_KIND.BLOCKED_BY
    ? { blockerTaskId: otherId, blockedTaskId: taskId }
    : { blockerTaskId: taskId, blockedTaskId: otherId };
}

export const relationAsked = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  relation: TaskCreateRelation,
  repositoryAsked: string | null | undefined,
): Effect.fn.Return<
  TaskCreateRelationAsked | undefined,
  TaskRelationUnreached | TaskParentRepositoryDiffers | StoreFailure,
  DatabaseServices
> {
  const { kind, taskId } = relation;
  if (kind === TASK_CREATE_RELATION_KIND.SUB_TASK_OF) return undefined;
  const header = yield* readTaskHeader(userId, taskId);
  if (Option.isNone(header) || header.value.workspaceId !== workspaceId) {
    return yield* new TaskRelationUnreached();
  }
  if (kind !== TASK_CREATE_RELATION_KIND.PARENT_OF) return { kind, taskId };
  const { repository } = header.value;
  if (repositoryAsked !== undefined && !sameRepository(repositoryAsked, repository)) {
    return yield* new TaskParentRepositoryDiffers({ repository });
  }
  return { kind, taskId, repository };
});

export const relationsAsked = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  relations: readonly TaskCreateRelation[],
  repositoryAsked: string | null | undefined,
): Effect.fn.Return<
  readonly TaskCreateRelationAsked[],
  TaskRelationUnreached | TaskParentRepositoryDiffers | StoreFailure,
  DatabaseServices
> {
  const confirmed: TaskCreateRelationAsked[] = [];
  let repository = repositoryAsked;
  for (const relation of relations) {
    const asked = yield* relationAsked(userId, workspaceId, relation, repository);
    if (asked === undefined) continue;
    if (asked.kind === TASK_CREATE_RELATION_KIND.PARENT_OF) repository = asked.repository;
    confirmed.push(asked);
  }
  return confirmed;
});

const parentTaken = (
  userId: string,
  taskId: string,
  otherId: string,
): Effect.Effect<
  Option.Option<void>,
  | StoreFailure
  | TaskParentHeld
  | TaskParentUnreached
  | TaskParentRepositoryDiffers
  | TaskParentCycle,
  DatabaseServices
> =>
  Effect.gen(function* () {
    const reached = yield* lockTasksForBlocks(userId, [otherId]);
    if (reached !== 1) return Option.none();
    const header = yield* readTaskHeader(userId, otherId);
    if (Option.isNone(header)) return Option.none();
    if (header.value.parentTaskId !== null) return yield* new TaskParentHeld();
    return Option.map(yield* setTaskParent(userId, otherId, taskId), () => undefined);
  });

export function relationWritten(
  userId: string,
  taskId: string,
  asked: TaskCreateRelationAsked,
): Effect.Effect<void, StoreFailure | TaskCreateRelationRefused, DatabaseServices> {
  const written: Effect.Effect<
    Option.Option<void>,
    StoreFailure | TaskCreateRelationRefused,
    DatabaseServices
  > = asked.kind === TASK_CREATE_RELATION_KIND.PARENT_OF
    ? parentTaken(userId, taskId, asked.taskId)
    : Effect.map(
        addTaskBlock(userId, blockPairOf(taskId, asked.taskId, asked.kind)),
        Option.map(() => undefined),
      );
  return Effect.flatMap(written, (related) =>
    Option.isNone(related) ? Effect.fail(new TaskRelationUnreached()) : Effect.void,
  );
}

function taskStarted(
  userId: string,
  started: NewTask & { readonly id?: string },
  holding: readonly string[],
): Effect.Effect<
  TaskStartCommitted,
  StoreFailure | TaskAssigneeNotMember | TaskIdTaken,
  DatabaseServices
> {
  const { id } = started;
  if (id !== undefined) return createTaskCommittedOnce(userId, { ...started, id }, holding);
  return Effect.map(createTaskCommitted(userId, started, holding), (created) => ({
    ...created,
    made: true,
  }));
}

export function createTaskRelated(
  userId: string,
  started: NewTask & { readonly id?: string },
  asked: readonly TaskCreateRelationAsked[],
): Effect.Effect<
  TaskStartCommitted,
  StoreFailure | TaskAssigneeNotMember | TaskIdTaken | TaskCreateRelationRefused,
  DatabaseServices
> {
  if (asked.length === 0) return taskStarted(userId, started, []);
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const touched = asked.map((relation) => relation.taskId);
        const created = yield* taskStarted(
          userId,
          started,
          started.parentTaskId === undefined ? touched : [started.parentTaskId, ...touched],
        );
        if (!created.made) return created;
        const taskId = created.task.task.id;
        for (const relation of asked) yield* relationWritten(userId, taskId, relation);
        const read = yield* readTask(userId, taskId);
        if (Option.isNone(read))
          return yield* Effect.die(new Error("the task started did not read"));
        return created.txid === undefined
          ? { task: read.value, made: true }
          : { task: read.value, txid: created.txid, made: true };
      }),
    ),
  );
}

type RevisionWriter = Parameters<typeof recordRevision>[0]["writer"];

export type TaskCreateAsked = Omit<NewTask, "repository" | "githubAccess" | "assigneeId"> & {
  readonly id?: string;
  readonly repository?: string | null;
  readonly assigneeId?: string | null;
  readonly relations: readonly TaskCreateRelation[];
  readonly writer?: RevisionWriter;
};

export interface TaskCreated extends TaskStartCommitted {
  readonly repository: string | null;
  readonly githubAccess: GitHubAccess;
}

export const createTaskAsked = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  asked: TaskCreateAsked,
  source: (typeof SERVER_TASK_SOURCE)[keyof typeof SERVER_TASK_SOURCE],
): Effect.fn.Return<
  TaskCreated,
  StoreFailure | HostedRefusal | TaskAssigneeNotMember | TaskIdTaken | TaskCreateRelationRefused,
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  const {
    relations,
    writer,
    organizationId,
    repository,
    assigneeId: assigneeAsked,
    ...fields
  } = asked;
  const parentTaskId =
    asked.parentTaskId ??
    relations.find((relation) => relation.kind === TASK_CREATE_RELATION_KIND.SUB_TASK_OF)?.taskId;
  const parent =
    parentTaskId === undefined
      ? undefined
      : yield* taskParentOf(userId, organizationId, parentTaskId, repository);
  const beside = yield* relationsAsked(
    userId,
    organizationId,
    relations,
    parent === undefined ? repository : parent.repository,
  );
  const childOf = beside.find((each) => each.kind === TASK_CREATE_RELATION_KIND.PARENT_OF);
  const named =
    parent !== undefined
      ? parent.repository
      : childOf?.kind === TASK_CREATE_RELATION_KIND.PARENT_OF
        ? childOf.repository
        : repository;
  const reached =
    named === undefined || named === null
      ? { repository: null, githubAccess: GITHUB_ACCESS.APP }
      : yield* Effect.map(workspaceRepository(organizationId, named, userId), (each) => ({
          repository: each.repository.fullName,
          githubAccess: each.access,
        }));
  const assigneeId = assigneeAsked === undefined ? parent?.assigneeId : assigneeAsked;
  const started = {
    ...fields,
    organizationId,
    ...reached,
    ...(assigneeId === null || assigneeId === undefined ? undefined : { assigneeId }),
    ...(parent === undefined ? undefined : { parentTaskId: parent.id }),
  };
  const text = started.text ?? "";
  const write = createTaskRelated(userId, started, beside);
  const created =
    text === "" || writer === undefined
      ? yield* write
      : yield* Effect.flatMap(SqlClient.SqlClient, (client) =>
          client.withTransaction(
            Effect.tap(write, (made) =>
              made.made
                ? recordRevision({
                    taskId: made.task.task.id,
                    writer,
                    userId,
                    before: "",
                    after: text,
                    changes: 1,
                    savedBefore: Option.none(),
                  })
                : Effect.void,
            ),
          ),
        );
  if (created.made) {
    yield* recordServerEvent(
      SERVER_EVENT.TASK_CREATE,
      { userId, workspaceId: organizationId },
      {
        source,
      },
    );
  }
  return { ...created, ...reached };
});
