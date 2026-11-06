import { createHash } from "node:crypto";
import {
  CONVERSATION_PICTURE_BOUNDS,
  type ConversationMediaType,
  conversationMediaTypeSchema,
  type KeptPicture,
} from "@repo/features/conversation-picture-wire";
import { and, eq, sum } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { attachment } from "../schemas/attachment.js";
import type { TaskStoreEffect } from "./task-store.js";
import type { ConversationTarget } from "./writer.js";

export interface PictureToKeep {
  readonly bytes: Uint8Array;
  readonly contentType: ConversationMediaType;
  readonly width: number;
  readonly height: number;
}

export interface StoredPicture {
  readonly contentType: ConversationMediaType;
  readonly bytes: Uint8Array;
}

const KeptRowSchema = Schema.Struct({
  id: Schema.String,
  contentType: conversationMediaTypeSchema,
  width: Schema.Int,
  height: Schema.Int,
  byteCount: Schema.Int,
});

const KEPT_COLUMNS = {
  id: attachment.id,
  contentType: attachment.contentType,
  width: attachment.width,
  height: attachment.height,
  byteCount: attachment.byteCount,
};

const findByHash = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, sha256: Schema.String }),
  Result: KeptRowSchema,
  execute: ({ conversationId, sha256 }) =>
    Database.use((db) =>
      db
        .select(KEPT_COLUMNS)
        .from(attachment)
        .where(and(eq(attachment.conversationId, conversationId), eq(attachment.sha256, sha256))),
    ),
});

const sumKept = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String }),
  Result: Schema.Struct({ kept: Schema.NullOr(Schema.Number) }),
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db
        .select({ kept: sum(attachment.byteCount).mapWith(Number) })
        .from(attachment)
        .where(eq(attachment.conversationId, conversationId)),
    ),
});

const insertPicture = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    sha256: Schema.String,
    contentType: conversationMediaTypeSchema,
    width: Schema.Int,
    height: Schema.Int,
    bytes: Schema.Uint8Array,
    now: Schema.Date,
  }),
  Result: KeptRowSchema,
  execute: ({ now, bytes, ...row }) =>
    Database.use((db) =>
      db
        .insert(attachment)
        .values({ ...row, bytes, byteCount: bytes.byteLength, createdAt: now })
        .onConflictDoNothing({
          target: [attachment.conversationId, attachment.sha256],
        })
        .returning(KEPT_COLUMNS),
    ),
});

const findPicture = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, id: Schema.String }),
  Result: Schema.Struct({ contentType: conversationMediaTypeSchema, bytes: Schema.Uint8Array }),
  execute: ({ conversationId, id }) =>
    Database.use((db) =>
      db
        .select({
          contentType: attachment.contentType,
          bytes: attachment.bytes,
        })
        .from(attachment)
        .where(and(eq(attachment.conversationId, conversationId), eq(attachment.id, id))),
    ),
});

function keptPicture(row: typeof KeptRowSchema.Type): KeptPicture {
  return {
    id: row.id,
    mediaType: row.contentType,
    width: row.width,
    height: row.height,
    byteCount: row.byteCount,
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function keepConversationPicture(
  target: ConversationTarget,
  picture: PictureToKeep,
): TaskStoreEffect<Option.Option<KeptPicture>> {
  return Effect.gen(function* () {
    const { conversationId } = target;
    const sha256 = sha256Hex(picture.bytes);
    const held = yield* findByHash({ conversationId, sha256 });
    if (Option.isSome(held)) return Option.some(keptPicture(held.value));
    const [summed] = yield* sumKept({ conversationId });
    const keptBytes = summed?.kept ?? 0;
    if (
      keptBytes + picture.bytes.byteLength >
      CONVERSATION_PICTURE_BOUNDS.MAX_BYTES_PER_CONVERSATION
    ) {
      return Option.none();
    }
    const now = yield* DateTime.nowAsDate;
    const [inserted] = yield* insertPicture({
      ...picture,
      userId: target.userId,
      conversationId,
      sha256,
      now,
    });
    if (inserted !== undefined) return Option.some(keptPicture(inserted));
    return Option.map(yield* findByHash({ conversationId, sha256 }), keptPicture);
  });
}

export function readConversationPicture(
  conversationId: string,
  id: string,
): TaskStoreEffect<Option.Option<StoredPicture>> {
  return findPicture({ conversationId, id });
}
