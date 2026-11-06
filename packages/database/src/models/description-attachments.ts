import { randomUUID } from "node:crypto";
import {
  isVideoPicture,
  PICTURE_MEDIA_TYPE,
  type Picture,
  pictureMediaTypeSchema,
} from "@repo/features/picture-wire";
import { DESCRIPTION_ATTACHMENT_BOUNDS } from "@repo/features/description-attachment-wire";
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { attachment, ownedByTaskAlone } from "../schemas/attachment.js";
import { task } from "../schemas/task.js";
import type { TaskStoreEffect } from "./task-store.js";
import { reachableTask, taskReachableBy } from "./workspace-store.js";

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

const PURGE_BATCH = 200;

const descriptionPicture = ownedByTaskAlone(attachment);

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

const lockUnsaved = SqlSchema.findAll({
  Request: Schema.Struct({ before: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ before }) =>
    Database.use((db) =>
      db
        .select({ id: attachment.id })
        .from(attachment)
        .innerJoin(task, eq(task.id, attachment.taskId))
        .where(
          and(descriptionPicture, isNull(attachment.savedAt), lt(attachment.createdAt, before)),
        )
        .orderBy(asc(attachment.createdAt))
        .limit(PURGE_BATCH)
        .for("update", { of: task, skipLocked: true }),
    ),
});

const deletePictures = SqlSchema.void({
  Request: Schema.Struct({ ids: Schema.Array(Schema.String) }),
  execute: ({ ids }) =>
    Database.use((db) =>
      db.delete(attachment).where(and(inArray(attachment.id, [...ids]), descriptionPicture)),
    ),
});

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

export function readDescriptionAttachment(
  userId: string,
  taskId: string,
  attachmentId: string,
): TaskStoreEffect<Option.Option<Picture>> {
  return findPicture({ userId, taskId, attachmentId });
}

export function stampSavedAttachments(
  taskId: string,
  ids: readonly string[],
): TaskStoreEffect<void> {
  if (ids.length === 0) return Effect.void;
  return Effect.flatMap(DateTime.nowAsDate, (now) => stampSaved({ taskId, ids, now }));
}

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
