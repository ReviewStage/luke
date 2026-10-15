import { randomUUID } from "node:crypto";
import { type Picture, pictureTypeSchema } from "@luke/features/picture-wire";
import { PLAN_ATTACHMENT_BOUNDS } from "@luke/features/plan-attachment-wire";
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { planAttachment } from "../schemas/plan-attachment.js";
import { task } from "../schemas/task.js";
import type { TaskStoreEffect } from "./task-store.js";
import { reachableTask, taskReachableBy } from "./workspace-store.js";

/**
 * plan-attachments.ts -- a plan's pictures: keep one, read one, stamp the ones a save names, and sweep the uploads no save named.
 *
 * A picture is kept under the plan row's own lock, so the count it is held
 * to cannot be crossed by a second upload, and an archived plan, which no
 * editor is drawn on, keeps none. Every read names the account beside the
 * plan and gates on its membership of the plan's workspace, so a member
 * reads a picture a teammate pasted and a plan of a workspace the account is
 * not in reads as no plan, exactly as in `plan-store.ts`. A save stamps the
 * pictures its text names (`savePlanText`), and the sweep deletes a day-old
 * picture no save ever stamped, a sweep's worth at a time.
 */

/** What keeping a picture came to: kept under its new id, refused for the plan's count, or no plan to keep it on. */
export const PLAN_ATTACHMENT_KEEP = {
  KEPT: "kept",
  TOO_MANY: "too-many",
  NO_TASK: "no-plan",
} as const;

export type PlanAttachmentKeep =
  | { readonly status: typeof PLAN_ATTACHMENT_KEEP.KEPT; readonly id: string }
  | { readonly status: typeof PLAN_ATTACHMENT_KEEP.TOO_MANY }
  | { readonly status: typeof PLAN_ATTACHMENT_KEEP.NO_TASK };

/** The most unsaved pictures one sweep deletes, so a sweep stays bounded however many piled up. */
const PURGE_BATCH = 200;

/** The plan's id under its row's lock, where the account reaches it and it is not archived; nothing otherwise. */
const lockOpenTask = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({ id: task.id })
        .from(task)
        .where(and(reachableTask(userId, taskId), isNull(task.archivedAt)))
        .for("update"),
    ),
});

const countPictures = SqlSchema.findOne({
  Request: Schema.Struct({ taskId: Schema.String }),
  Result: Schema.Struct({ count: Schema.Number }),
  execute: ({ taskId }) =>
    Database.use((db) =>
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(planAttachment)
        .where(eq(planAttachment.taskId, taskId)),
    ),
});

const insertPicture = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    taskId: Schema.String,
    userId: Schema.String,
    contentType: pictureTypeSchema,
    byteCount: Schema.Number,
    bytes: Schema.Uint8Array,
    createdAt: Schema.Date,
  }),
  execute: (row) => Database.use((db) => db.insert(planAttachment).values(row)),
});

const findPicture = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    taskId: Schema.String,
    attachmentId: Schema.String,
  }),
  Result: Schema.Struct({ contentType: pictureTypeSchema, bytes: Schema.Uint8Array }),
  execute: ({ userId, taskId, attachmentId }) =>
    Database.use((db) =>
      db
        .select({ contentType: planAttachment.contentType, bytes: planAttachment.bytes })
        .from(planAttachment)
        .innerJoin(task, eq(task.id, planAttachment.taskId))
        .where(
          and(
            eq(planAttachment.taskId, taskId),
            eq(planAttachment.id, attachmentId),
            taskReachableBy(userId),
          ),
        ),
    ),
});

const stampSaved = SqlSchema.void({
  Request: Schema.Struct({
    taskId: Schema.String,
    ids: Schema.Array(Schema.String),
    now: Schema.Date,
  }),
  execute: ({ taskId, ids, now }) =>
    Database.use((db) =>
      db
        .update(planAttachment)
        .set({ savedAt: now })
        .where(
          and(
            eq(planAttachment.taskId, taskId),
            inArray(planAttachment.id, [...ids]),
            isNull(planAttachment.savedAt),
          ),
        ),
    ),
});

/**
 * The oldest unsaved pictures uploaded before the cutoff, a sweep's worth,
 * their plans locked until the transaction ends. Note that a plan a save
 * holds locked is skipped, because the save may be stamping one of them
 * this moment; the next sweep reads it again.
 */
const lockUnsaved = SqlSchema.findAll({
  Request: Schema.Struct({ before: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ before }) =>
    Database.use((db) =>
      db
        .select({ id: planAttachment.id })
        .from(planAttachment)
        .innerJoin(task, eq(task.id, planAttachment.taskId))
        .where(and(isNull(planAttachment.savedAt), lt(planAttachment.createdAt, before)))
        .orderBy(asc(planAttachment.createdAt))
        .limit(PURGE_BATCH)
        .for("update", { of: task, skipLocked: true }),
    ),
});

const deletePictures = SqlSchema.void({
  Request: Schema.Struct({ ids: Schema.Array(Schema.String) }),
  execute: ({ ids }) =>
    Database.use((db) => db.delete(planAttachment).where(inArray(planAttachment.id, [...ids]))),
});

/**
 * Keeps one picture on the plan, uploaded by the account, under a new id;
 * refused where the plan already holds its bound of pictures, and nothing
 * where the account reaches no such plan or the plan is archived.
 */
export function keepPlanAttachment(
  userId: string,
  taskId: string,
  picture: Picture,
): TaskStoreEffect<PlanAttachmentKeep> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockOpenTask({ userId, taskId });
        if (Option.isNone(locked)) return { status: PLAN_ATTACHMENT_KEEP.NO_TASK } as const;
        // A count that returned no row is the database breaking its own contract, not an outcome.
        const { count } = yield* countPictures({ taskId }).pipe(
          Effect.catchTag("NoSuchElementError", Effect.die),
        );
        if (count >= PLAN_ATTACHMENT_BOUNDS.MAX_PER_PLAN) {
          return { status: PLAN_ATTACHMENT_KEEP.TOO_MANY } as const;
        }
        const id = randomUUID();
        yield* insertPicture({
          id,
          taskId,
          userId,
          contentType: picture.contentType,
          byteCount: picture.bytes.length,
          bytes: picture.bytes,
          createdAt: yield* DateTime.nowAsDate,
        });
        return { status: PLAN_ATTACHMENT_KEEP.KEPT, id } as const;
      }),
    ),
  );
}

/** One picture of the plan, its type and bytes; nothing where the account reaches no such plan or the plan no such picture. */
export function readPlanAttachment(
  userId: string,
  taskId: string,
  attachmentId: string,
): TaskStoreEffect<Option.Option<Picture>> {
  return findPicture({ userId, taskId, attachmentId });
}

/** Stamps the plan's pictures the saved text names as saved, the ones no save stamped before; nothing where it names none. */
export function stampSavedAttachments(
  taskId: string,
  ids: readonly string[],
): TaskStoreEffect<void> {
  if (ids.length === 0) return Effect.void;
  return Effect.flatMap(DateTime.nowAsDate, (now) => stampSaved({ taskId, ids, now }));
}

/**
 * The scheduled sweep's delete of the pictures no save named, uploaded
 * before `before`, a sweep's worth, under their plans' locks, so a save
 * stamping one cannot cross it; how many went.
 */
export function purgeUnsavedAttachments(before: Date): TaskStoreEffect<number> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const ids = (yield* lockUnsaved({ before })).map((row) => row.id);
        if (ids.length > 0) yield* deletePictures({ ids });
        return ids.length;
      }),
    ),
  );
}
