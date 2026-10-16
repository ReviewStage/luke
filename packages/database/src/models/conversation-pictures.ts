import { createHash } from "node:crypto";
import {
  CONVERSATION_PICTURE_BOUNDS,
  type KeptPicture,
} from "@luke/features/conversation-picture-wire";
import { type InboxImageType, inboxImageTypeSchema } from "@luke/features/inbox-wire";
import { and, eq, sum } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { conversationAttachment } from "../schemas/conversation-attachment.js";
import type { PlanStoreEffect } from "./plan-store.js";
import type { ConversationTarget } from "./writer.js";

/**
 * conversation-pictures.ts -- the pictures a conversation's tools answered, kept once each beside the transcript that names them.
 *
 * The relay hands each picture in as it settles the call that answered it
 * (`brain-host/relay-pictures.ts`), already sniffed and measured, and
 * writes the id this answers into the stored output in the bytes' place.
 * A picture is keyed by the hash of its bytes within its conversation, so
 * handing the same one in again answers the row already kept, and an
 * event eve delivers twice keeps nothing twice. A conversation keeps at
 * most `MAX_BYTES_PER_CONVERSATION` of pictures, read off the rows' byte
 * counts; a picture that would take it past them is not kept, and the
 * caller names it as not kept. A read names the conversation beside the
 * picture, so whoever reads has settled first that the reader may read
 * that conversation, as every transcript read does.
 */

/** A picture to keep: its bytes, the type they were sniffed to be, and the size their header states. */
export interface PictureToKeep {
  readonly bytes: Uint8Array;
  readonly contentType: InboxImageType;
  readonly width: number;
  readonly height: number;
}

/** A kept picture as a read answers it: the type it is served under, and its bytes. */
export interface StoredPicture {
  readonly contentType: InboxImageType;
  readonly bytes: Uint8Array;
}

const KeptRowSchema = Schema.Struct({
  id: Schema.String,
  contentType: inboxImageTypeSchema,
  width: Schema.Int,
  height: Schema.Int,
  byteCount: Schema.Int,
});

const KEPT_COLUMNS = {
  id: conversationAttachment.id,
  contentType: conversationAttachment.contentType,
  width: conversationAttachment.width,
  height: conversationAttachment.height,
  byteCount: conversationAttachment.byteCount,
};

const findByHash = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, sha256: Schema.String }),
  Result: KeptRowSchema,
  execute: ({ conversationId, sha256 }) =>
    Database.use((db) =>
      db
        .select(KEPT_COLUMNS)
        .from(conversationAttachment)
        .where(
          and(
            eq(conversationAttachment.conversationId, conversationId),
            eq(conversationAttachment.sha256, sha256),
          ),
        ),
    ),
});

const sumKept = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String }),
  Result: Schema.Struct({ kept: Schema.NullOr(Schema.Number) }),
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db
        .select({ kept: sum(conversationAttachment.byteCount).mapWith(Number) })
        .from(conversationAttachment)
        .where(eq(conversationAttachment.conversationId, conversationId)),
    ),
});

const insertPicture = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    sha256: Schema.String,
    contentType: inboxImageTypeSchema,
    width: Schema.Int,
    height: Schema.Int,
    bytes: Schema.Uint8Array,
    now: Schema.Date,
  }),
  Result: KeptRowSchema,
  execute: ({ now, bytes, ...row }) =>
    Database.use((db) =>
      db
        .insert(conversationAttachment)
        .values({ ...row, bytes, byteCount: bytes.byteLength, createdAt: now })
        .onConflictDoNothing({
          target: [conversationAttachment.conversationId, conversationAttachment.sha256],
        })
        .returning(KEPT_COLUMNS),
    ),
});

const findPicture = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, id: Schema.String }),
  Result: Schema.Struct({ contentType: inboxImageTypeSchema, bytes: Schema.Uint8Array }),
  execute: ({ conversationId, id }) =>
    Database.use((db) =>
      db
        .select({
          contentType: conversationAttachment.contentType,
          bytes: conversationAttachment.bytes,
        })
        .from(conversationAttachment)
        .where(
          and(
            eq(conversationAttachment.conversationId, conversationId),
            eq(conversationAttachment.id, id),
          ),
        ),
    ),
});

/** A kept row as a stored output names it. */
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

/**
 * Keeps one picture beside the conversation, and answers it as a stored
 * output names it: the row already kept for the same bytes, or a new one;
 * nothing where keeping it would take the conversation past its bytes. Note
 * that a write that raced another to the same bytes reads the winner's row,
 * because the insert stands down on the hash rather than failing.
 */
export function keepConversationPicture(
  target: ConversationTarget,
  picture: PictureToKeep,
): PlanStoreEffect<Option.Option<KeptPicture>> {
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

/** One kept picture of the conversation: its type and its bytes; nothing where the conversation keeps no such picture. */
export function readConversationPicture(
  conversationId: string,
  id: string,
): PlanStoreEffect<Option.Option<StoredPicture>> {
  return findPicture({ conversationId, id });
}
