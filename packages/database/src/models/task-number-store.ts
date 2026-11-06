import { and, eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { task, taskNumberForward } from "../schemas/task.js";
import {
  isWorkspaceMember,
  taskReachableBy,
  type WorkspaceStoreEffect,
} from "./workspace-store.js";
import { workspaceIdOfSlug } from "./workspace-slug-store.js";

const TaskNumberSchema = Schema.Struct({
  userId: Schema.String,
  organizationId: Schema.String,
  number: Schema.Number,
});

const TaskIdSchema = Schema.Struct({ id: Schema.String });

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

export function forwardTaskNumber(left: {
  readonly organizationId: string;
  readonly number: number;
  readonly taskId: string;
}): WorkspaceStoreEffect<void> {
  return insertForward(left);
}

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
