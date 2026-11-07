import { randomUUID } from "node:crypto";
import { DESCRIPTION_ATTACHMENT_BOUNDS } from "@repo/features/description-attachment-wire";
import {
  isVideoPicture,
  PICTURE_MEDIA_TYPE,
  type Picture,
  pictureMediaTypeSchema,
} from "@repo/features/picture-wire";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { attachment, ownedByTaskAlone } from "../schemas/attachment.js";
import { task } from "../schemas/task.js";
import type { TaskStoreEffect } from "./task-store.js";
import { reachableTask, taskReachableBy } from "./workspace-store.js";

/**
 * description-attachments.ts -- a description's pictures: keep one, read one, and stamp the ones a save names.
 *
 * A picture, or a video an agent recorded, is kept under the plan row's own
 * lock, so the counts it is held to, every picture's and every video's,
 * cannot be crossed by a second upload. Every read names the account beside the
 * plan and gates on its membership of the plan's workspace, so a member
 * reads a picture a teammate pasted and a plan of a workspace the account is
 * not in reads as no plan, exactly as in `plan-store.ts`. A save stamps the
 * pictures its text names (`saveDescriptionText`). A picture stays until its
 * task is deleted, which cascades to it, whether or not a save named it.
 * Note that the stamp is still written though nothing here reads it, because
 * a rollback to a release that still runs the old unsaved-picture purge would
 * otherwise delete every picture saved since; a later release stops writing it
 * and drops the column once this one is the rollback floor.
 */

/** What keeping a picture came to: kept under its new id, refused for the description's count of pictures or of videos, or no plan to keep it on. */
export const DESCRIPTION_ATTACHMENT_KEEP = {
  KEPT: "kept",
  TOO_MANY: "too-many",
  TOO_MANY_VIDEOS: "too-many-videos",
  NO_TASK: "no-plan",
} as const;

export type DescriptionAttachmentKeep =
  | { readonly status: typeof DESCRIPTION_ATTACHMENT_KEEP.KEPT; readonly id: string }
  | { readonly status: typeof DESCRIPTION_ATTACHMENT_KEEP.TOO_MANY }
  | { readonly status: typeof DESCRIPTION_ATTACHMENT_KEEP.TOO_MANY_VIDEOS }
  | { readonly status: typeof DESCRIPTION_ATTACHMENT_KEEP.NO_TASK };

/** A description's pictures among every attachment: the ones its task owns alone. */
const descriptionPicture = ownedByTaskAlone(attachment);

/** The plan's id and workspace under its row's lock, where the account reaches it; nothing otherwise. */
const lockOpenTask = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String, organizationId: Schema.String }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({ id: task.id, organizationId: task.organizationId })
        .from(task)
        .where(reachableTask(userId, taskId))
        .for("update"),
    ),
});

/** How many pictures the description holds, and how many of them are videos. */
const countPictures = SqlSchema.findOne({
  Request: Schema.Struct({ taskId: Schema.String }),
  Result: Schema.Struct({ count: Schema.Number, videos: Schema.Number }),
  execute: ({ taskId }) =>
    Database.use((db) =>
      db
        .select({
          count: sql<number>`count(*)::int`,
          videos: sql<number>`(count(*) filter (where ${eq(attachment.contentType, PICTURE_MEDIA_TYPE.WEBM)}))::int`,
        })
        .from(attachment)
        .where(and(eq(attachment.taskId, taskId), descriptionPicture)),
    ),
});

const insertPicture = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    taskId: Schema.String,
    organizationId: Schema.String,
    userId: Schema.String,
    contentType: pictureMediaTypeSchema,
    byteCount: Schema.Number,
    bytes: Schema.Uint8Array,
    createdAt: Schema.Date,
  }),
  execute: (row) => Database.use((db) => db.insert(attachment).values(row)),
});

const findPicture = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    taskId: Schema.String,
    attachmentId: Schema.String,
  }),
  Result: Schema.Struct({ contentType: pictureMediaTypeSchema, bytes: Schema.Uint8Array }),
  execute: ({ userId, taskId, attachmentId }) =>
    Database.use((db) =>
      db
        .select({ contentType: attachment.contentType, bytes: attachment.bytes })
        .from(attachment)
        .innerJoin(task, eq(task.id, attachment.taskId))
        .where(
          and(
            eq(attachment.taskId, taskId),
            eq(attachment.id, attachmentId),
            descriptionPicture,
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
        .update(attachment)
        .set({ savedAt: now })
        .where(
          and(
            eq(attachment.taskId, taskId),
            inArray(attachment.id, [...ids]),
            descriptionPicture,
            isNull(attachment.savedAt),
          ),
        ),
    ),
});

/**
 * Keeps one picture or video on the description, uploaded by the account, under a
 * new id; refused where the description already holds its bound of pictures, or a
 * video where it holds its bound of videos, and nothing where the account
 * reaches no such plan.
 */
export function keepDescriptionAttachment(
  userId: string,
  taskId: string,
  picture: Picture,
): TaskStoreEffect<DescriptionAttachmentKeep> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockOpenTask({ userId, taskId });
        if (Option.isNone(locked)) return { status: DESCRIPTION_ATTACHMENT_KEEP.NO_TASK } as const;
        // A count that returned no row is the database breaking its own contract, not an outcome.
        const { count, videos } = yield* countPictures({ taskId }).pipe(
          Effect.catchTag("NoSuchElementError", Effect.die),
        );
        if (count >= DESCRIPTION_ATTACHMENT_BOUNDS.MAX_PER_DESCRIPTION) {
          return { status: DESCRIPTION_ATTACHMENT_KEEP.TOO_MANY } as const;
        }
        if (
          isVideoPicture(picture) &&
          videos >= DESCRIPTION_ATTACHMENT_BOUNDS.MAX_VIDEOS_PER_DESCRIPTION
        ) {
          return { status: DESCRIPTION_ATTACHMENT_KEEP.TOO_MANY_VIDEOS } as const;
        }
        const id = randomUUID();
        yield* insertPicture({
          id,
          taskId,
          organizationId: locked.value.organizationId,
          userId,
          contentType: picture.contentType,
          byteCount: picture.bytes.length,
          bytes: picture.bytes,
          createdAt: yield* DateTime.nowAsDate,
        });
        return { status: DESCRIPTION_ATTACHMENT_KEEP.KEPT, id } as const;
      }),
    ),
  );
}

/** One picture or video of the description, its type and bytes; nothing where the account reaches no such plan or the description no such picture. */
export function readDescriptionAttachment(
  userId: string,
  taskId: string,
  attachmentId: string,
): TaskStoreEffect<Option.Option<Picture>> {
  return findPicture({ userId, taskId, attachmentId });
}

/** Stamps the description's pictures the saved text names as saved, the ones no save stamped before; nothing where it names none. */
export function stampSavedAttachments(
  taskId: string,
  ids: readonly string[],
): TaskStoreEffect<void> {
  if (ids.length === 0) return Effect.void;
  return Effect.flatMap(DateTime.nowAsDate, (now) => stampSaved({ taskId, ids, now }));
}
