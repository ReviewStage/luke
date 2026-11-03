import { and, eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { member, organization } from "../schemas/auth.js";
import { task, taskNumberForward } from "../schemas/task.js";
import {
  isWorkspaceMember,
  taskReachableBy,
  type WorkspaceStoreEffect,
} from "./workspace-store.js";

/**
 * task-number-store.ts -- a task found by its number in a workspace, as a link `/<slug>/task/<number>` names it, and the numbers a task left behind as it moved.
 *
 * A task's number is its workspace's, never handed out again (`task.ts`'s
 * `task_number_counter`), so a workspace and a number name one task for
 * good: the task holding it now, or else the task that held it before it
 * moved to another workspace (`task_number_forward`), written as it moves.
 * Either is answered only to an account that reaches the task where it
 * stands now, and the workspace is found by its slug, or its id, only for
 * a member of it, so a number another account's workspace holds, one
 * naming no task, and a slug naming no workspace of the reader's all
 * answer as nothing.
 */

const TaskNumberSchema = Schema.Struct({
  userId: Schema.String,
  organizationId: Schema.String,
  number: Schema.Number,
});

const TaskIdSchema = Schema.Struct({ id: Schema.String });

/**
 * The workspace a slug names to the account, of those it is a member of.
 *
 * Note that this reads the current slug alone, standing in for the
 * workspace slug resolver (`workspaceIdOfSlug`) that reads former slugs
 * too, which this is swapped for once it lands.
 */
const findMemberWorkspaceOfSlug = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, slug: Schema.String }),
  Result: TaskIdSchema,
  execute: ({ userId, slug }) =>
    Database.use((db) =>
      db
        .select({ id: organization.id })
        .from(organization)
        .innerJoin(member, eq(member.organizationId, organization.id))
        .where(and(eq(organization.slug, slug), eq(member.userId, userId)))
        .limit(1),
    ),
});

function workspaceIdOfSlug(
  userId: string,
  slug: string,
): WorkspaceStoreEffect<Option.Option<string>> {
  return Effect.map(
    findMemberWorkspaceOfSlug({ userId, slug }),
    Option.map((row) => row.id),
  );
}

/**
 * The workspace a link's step names to the account: by its slug, or else
 * by its id, as a link written before its slug was known spells it; only
 * one it is a member of.
 */
function memberWorkspaceOfStep(
  userId: string,
  step: string,
): WorkspaceStoreEffect<Option.Option<string>> {
  return Effect.gen(function* () {
    const bySlug = yield* workspaceIdOfSlug(userId, step);
    if (Option.isSome(bySlug)) return bySlug;
    return (yield* isWorkspaceMember(userId, step)) ? Option.some(step) : Option.none();
  });
}

/** The task holding the number in the workspace now, where the account reaches it. */
const findNumberedTask = SqlSchema.findOneOption({
  Request: TaskNumberSchema,
  Result: TaskIdSchema,
  execute: ({ userId, organizationId, number }) =>
    Database.use((db) =>
      db
        .select({ id: task.id })
        .from(task)
        .where(
          and(
            eq(task.organizationId, organizationId),
            eq(task.number, number),
            taskReachableBy(userId),
          ),
        )
        .limit(1),
    ),
});

/** The task that held the number in the workspace before it moved out, where the account reaches it where it stands now. */
const findForwardedTask = SqlSchema.findOneOption({
  Request: TaskNumberSchema,
  Result: TaskIdSchema,
  execute: ({ userId, organizationId, number }) =>
    Database.use((db) =>
      db
        .select({ id: task.id })
        .from(taskNumberForward)
        .innerJoin(task, eq(task.id, taskNumberForward.taskId))
        .where(
          and(
            eq(taskNumberForward.organizationId, organizationId),
            eq(taskNumberForward.number, number),
            taskReachableBy(userId),
          ),
        )
        .limit(1),
    ),
});

const insertForward = SqlSchema.void({
  Request: Schema.Struct({
    organizationId: Schema.String,
    number: Schema.Number,
    taskId: Schema.String,
  }),
  execute: (left) =>
    Database.use((db) => db.insert(taskNumberForward).values(left).onConflictDoNothing()),
});

/**
 * The number a task held in the workspace it is moving out of, kept so a
 * link written with it still opens the task; called in the move's own
 * transaction, before or after its row changes.
 */
export function forwardTaskNumber(left: {
  readonly organizationId: string;
  readonly number: number;
  readonly taskId: string;
}): WorkspaceStoreEffect<void> {
  return insertForward(left);
}

/**
 * The id of the task a link's workspace, by slug or id, and number name:
 * the task holding the number in that workspace now, or the one that held
 * it before it moved out; nothing where the account is no member of such a
 * workspace, the number names no task there, or the account does not reach
 * the task where it stands now.
 */
export function taskIdOfNumber(
  userId: string,
  workspaceStep: string,
  number: number,
): WorkspaceStoreEffect<Option.Option<string>> {
  return Effect.gen(function* () {
    const workspace = yield* memberWorkspaceOfStep(userId, workspaceStep);
    if (Option.isNone(workspace)) return Option.none();
    const asked = { userId, organizationId: workspace.value, number };
    const held = yield* findNumberedTask(asked);
    const found = Option.isSome(held) ? held : yield* findForwardedTask(asked);
    return Option.map(found, (row) => row.id);
  });
}
