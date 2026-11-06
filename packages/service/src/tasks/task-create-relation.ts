/**
 * task-create-relation.ts -- a task made for a member, as every door makes one, with the relations it starts in, confirmed before it writes and written beside it in its own transaction.
 *
 * `createTaskAsked` is the one make: the app's New task, `create_task`, and
 * `start_agent`'s task for an agent on no task, each in its own words.
 *
 * A task may start related to others (`taskCreateRequestSchema`'s
 * `relations`, or an agent's `create_task`'s one `relation`, from the new
 * task's side): a sub-task of one, which the start makes as it makes a
 * child of `parentTaskId` (`task-parent.ts`); the parent of others; or a
 * block on either side. Each other task is read as its maker reaches it
 * before anything is written (`relationAsked`, `relationsAsked`), so one out
 * of reach, of another workspace, or named by nothing all read alike as
 * unreached, and a start as a task's parent takes that task's repository,
 * as a child takes its parent's, refusing a start that names another, so
 * every task of the tree a start joins works in one repository. Then, once
 * the task's row stands, each relation is written under the same
 * transaction (`relationWritten`), through the doors a relation added later
 * goes through (`setTaskParent`, `addTaskBlock`), so their rules hold and
 * the task and its relations land together or not at all. A start as a
 * parent is refused where the other task has a parent already, checked
 * under that task's lock, since a start never takes a parent's place.
 */

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
import { taskActivityReported } from "../accounts/onboarding-events.js";
import {
  recordServerEvent,
  SERVER_EVENT,
  type SERVER_TASK_SOURCE,
} from "../events/server-events.js";
import type { GitHubApp } from "../github/github-app.js";
import { workspaceRepository } from "../github/workspace-repository.js";
import type { HostedRefusal } from "../http/http-effect.js";
import { taskParentOf } from "./task-parent.js";

/** The other task a start's relation names is none the maker reaches in the workspace the task starts in; nothing was written. */
class TaskRelationUnreached extends Data.TaggedError("TaskRelationUnreached") {}

/** The task a start would be the parent of has a parent already, which a start never takes the place of; nothing was written. */
class TaskParentHeld extends Data.TaggedError("TaskParentHeld") {}

/** Why a start's relation was not written, nothing written: the other task out of reach, the parent's refusals, or the block's. */
export type TaskCreateRelationRefused =
  | TaskRelationUnreached
  | TaskParentHeld
  | TaskParentUnreached
  | TaskParentRepositoryDiffers
  | TaskParentCycle
  | TaskBlockSelf
  | TaskBlockAcrossWorkspaces
  | TaskBlockCycle;

/** The relation a start asked other than a sub-task's, which the start makes as a child of its parent instead, confirmed: the other task, how the new task stands to it, and, as the other's parent, the repository the new task takes. */
export type TaskCreateRelationAsked =
  | {
      readonly kind: typeof TASK_CREATE_RELATION_KIND.PARENT_OF;
      readonly taskId: string;
      /** The other task's repository, which the new task takes as its parent. */
      readonly repository: string | null;
    }
  | { readonly kind: TaskBlockRelation; readonly taskId: string };

/** Whether a repository a start names is the other task's: GitHub's names match whatever their case, and none matches none. */
function sameRepository(asked: string | null, held: string | null): boolean {
  if (asked === null || held === null) return asked === held;
  return asked.toLowerCase() === held.toLowerCase();
}

/** The block a kind names between the new task and the other, where the kind is a block's side. */
function blockPairOf(taskId: string, otherId: string, kind: TaskBlockRelation): TaskBlockPair {
  return kind === TASK_CREATE_RELATION_KIND.BLOCKED_BY
    ? { blockerTaskId: otherId, blockedTaskId: taskId }
    : { blockerTaskId: taskId, blockedTaskId: otherId };
}

/**
 * The relation a start asked other than a sub-task's, confirmed as `userId`
 * reaches the other task in `workspaceId`, before anything is written;
 * `repositoryAsked` is the one the start named, left out where it named
 * none, which a start as the other's parent must match. A start as a
 * sub-task is the parent's own check (`taskParentOf`), so it answers
 * nothing here.
 */
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

/**
 * Every relation a start asked other than a sub-task's, confirmed in order
 * as `relationAsked` confirms one, before anything is written;
 * `repositoryAsked` is the repository of the tree the start joins as a
 * sub-task where it joins one, the one it named otherwise, and left out
 * where it named none. Note that the first task a start is the parent of
 * names the repository each later one must match, because a start naming
 * none would otherwise take one tree's repository and join another's.
 */
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

/** The other task made the new task's child, under its lock; refused where it has a parent already, and nothing where it is out of reach by now. */
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
    // Note that the other task is held for update before its parent is read, because two starts as its
    // parent at once would each read none and the later write would take the earlier's place.
    const reached = yield* lockTasksForBlocks(userId, [otherId]);
    if (reached !== 1) return Option.none();
    const header = yield* readTaskHeader(userId, otherId);
    if (Option.isNone(header)) return Option.none();
    if (header.value.parentTaskId !== null) return yield* new TaskParentHeld();
    return Option.map(yield* setTaskParent(userId, otherId, taskId), () => undefined);
  });

/** The relation written for the task just started, under its maker's transaction: the other task made its child, or a block on the side the kind names; refused as unreached where the other task is out of reach by now. */
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

/** The task a start makes, holding `holding` as it does: under the id its maker chose where it names one (`createTaskCommittedOnce`), else under one the store mints, which this start always makes. */
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

/**
 * Starts the task as `createTaskCommitted` starts one, or under the id its
 * maker chose as `createTaskCommittedOnce` does, and writes every relation
 * asked beside it in one transaction, through the doors a relation added
 * later goes through (`setTaskParent`, `addTaskBlock`), so their rules hold
 * and the task and its relations land together or not at all, one refused
 * taking back the task and every relation before it; the task alone where
 * none is asked. A start sent again under its id answers the task the first
 * made, whose relations that one wrote, and writes none again. The task is
 * read again once the relations stand, since the window opens the answer
 * without reading it again, so it must carry them. Note that the row's
 * transaction id is the outer transaction's, which a nested write only marks
 * a savepoint in, so the answer's `txid` still names the one commit a
 * follower waits for.
 */
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
        // Note that every other task the start touches is held in id order before the task's row is written,
        // its parent among them, because each relation's write locks its own task in turn, and a relation
        // change between two of them locks both in id order, so the two would each hold a row the other waits on.
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
        // The row was written under this transaction, so a read that misses it is the database breaking its own contract.
        if (Option.isNone(read))
          return yield* Effect.die(new Error("the task started did not read"));
        return created.txid === undefined
          ? { task: read.value, made: true }
          : { task: read.value, txid: created.txid, made: true };
      }),
    ),
  );
}

/** Who a task's first description is written by, as its history names them. */
type RevisionWriter = Parameters<typeof recordRevision>[0]["writer"];

/** A task as a door asks for it: `NewTask`'s fields, the repository as named, the assignee null for no one, and the relations it starts in. */
export type TaskCreateAsked = Omit<NewTask, "repository" | "githubAccess" | "assigneeId"> & {
  readonly id?: string;
  /** The repository named, null for none; left out where none is named, which a task in a tree takes from the tree. */
  readonly repository?: string | null;
  /** The member it is assigned to, null for no one; left out for its parent's, or no one at the top. */
  readonly assigneeId?: string | null;
  readonly relations: readonly TaskCreateRelation[];
  /** Who the description's text is written by, as its first revision names them, where the task starts with text. */
  readonly writer?: RevisionWriter;
};

/** A task a make answered: as a start answers it, with the repository it records and how it was reached. */
export interface TaskCreated extends TaskStartCommitted {
  readonly repository: string | null;
  readonly githubAccess: GitHubAccess;
}

/**
 * Makes the task `userId` asked for, the make every door shares, each door
 * holding who may ask for what first. A child, by `parentTaskId` or a
 * sub-task relation, takes its parent's repository and, where it names no
 * assignee, its parent's (`taskParentOf`); a parent of others takes theirs
 * (`relationsAsked`); a repository is reached as the workspace reaches it.
 * The task, its description's first revision, and every relation are one write
 * (`createTaskRelated`). A make under an id that made its task answers it,
 * unmade, and counts none.
 */
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
  // A start as a sub-task of a task is a start under that parent, which `parentTaskId` names as well.
  const parentTaskId =
    asked.parentTaskId ??
    relations.find((relation) => relation.kind === TASK_CREATE_RELATION_KIND.SUB_TASK_OF)?.taskId;
  const parent =
    parentTaskId === undefined
      ? undefined
      : yield* taskParentOf(userId, organizationId, parentTaskId, repository);
  // A task's children share its parent's repository, so a start under a parent holds them to that one.
  const beside = yield* relationsAsked(
    userId,
    organizationId,
    relations,
    parent === undefined ? repository : parent.repository,
  );
  const childOf = beside.find((each) => each.kind === TASK_CREATE_RELATION_KIND.PARENT_OF);
  // A task in a tree works in the tree's repository: its parent's as a child, and its children's as a parent.
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
  // The task and its description's first revision land together, so a make run again at once makes one task.
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
    yield* taskActivityReported(userId);
  }
  return { ...created, ...reached };
});
