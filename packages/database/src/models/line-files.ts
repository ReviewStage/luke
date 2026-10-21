import { createHash } from "node:crypto";
import {
  CODING_AGENT_ATTACHMENT_TYPE,
  type CodingAgentAttachmentType,
} from "@luke/features/coding-agent-wire";
import { CONVERSATION_PICTURE_BOUNDS } from "@luke/features/conversation-picture-wire";
import { imageDimensions, sniffImageType } from "@luke/features/image-signature";
import { lineFileIdOf, lineFileUrl } from "@luke/features/line-file-wire";
import { MESSAGE_ROLE } from "@luke/wire";
import type { StoredUIMessage } from "@luke/wire/ui-messages";
import { isFileUIPart } from "ai";
import { and, asc, count, eq, gt, inArray, type SQL, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { attachment } from "../schemas/attachment.js";
import { messages } from "../schemas/storage.js";
import type { TaskStoreEffect } from "./task-store.js";
import type { ConversationTarget } from "./writer.js";

/**
 * line-files.ts -- the files a developer's line carried, kept once each beside the conversation and named in the row by id rather than carried as base64.
 *
 * A line's files once stood in its row as file parts over `data:` URLs
 * (`attached-file-parts.ts`), so every read of the transcript carried and
 * decoded them. A user row is now written with each such part's bytes kept
 * as a row of `attachment` owned by the conversation, keyed by the hash of
 * its bytes as a tool's picture is (`conversation-pictures.ts`), and the
 * part's URL naming that row (`@luke/features/line-file-wire`); the part
 * keeps its media type and name. Its bytes are served by the agent's
 * picture read, under whoever may read the agent.
 *
 * The rows written before stand as they were until the backfill moves them
 * (`moveInlineLineFiles`), a batch of rows at a time, each batch its own
 * short transaction, so a read takes both shapes meanwhile. A file part
 * whose bytes are past what a conversation's row may hold, or whose URL
 * spells no base64, is left as it stands and counted as remaining.
 */

type Parts = StoredUIMessage["parts"];

type Part = Parts[number];

/** How many rows one transaction of the backfill moves. */
export const LINE_FILE_BACKFILL = { BATCH_ROWS: 50 } as const;

/** A `data:` URL's media type and its base64, whole. */
const INLINE_URL = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/u;

/** The parts of a row that are file parts over a `data:` URL, as Postgres's path language finds them. */
const INLINE_FILE_PARTS = '$[*] ? (@.type == "file" && @.url starts with "data:")';

/** Whether a user row carries a file part over a `data:` URL. */
const carriesInlineFile: SQL = sql`(${messages.role} = ${MESSAGE_ROLE.USER} and jsonb_path_exists(${messages.parts}, ${INLINE_FILE_PARTS}::jsonpath))`;

const IMAGE_TYPES: ReadonlySet<string> = new Set([
  CODING_AGENT_ATTACHMENT_TYPE.PNG,
  CODING_AGENT_ATTACHMENT_TYPE.JPEG,
  CODING_AGENT_ATTACHMENT_TYPE.WEBP,
]);

/** A file to keep: its bytes and the type it travelled as. */
interface LineFile {
  readonly bytes: Uint8Array;
  readonly contentType: CodingAgentAttachmentType;
}

const FILE_TYPES: ReadonlySet<string> = new Set(Object.values(CODING_AGENT_ATTACHMENT_TYPE));

function isFileType(value: string): value is CodingAgentAttachmentType {
  return FILE_TYPES.has(value);
}

/** A row's parts as a column holds them: an array of parts, each naming its type; the vocabulary past that is `readStoredUIMessages`'s. */
const PartsColumnSchema: Schema.Codec<Parts> = Schema.declare((input): input is Parts =>
  Schema.is(Schema.Array(Schema.Struct({ type: Schema.String })))(input),
);

const KeptIdSchema = Schema.Struct({ id: Schema.String });

const findByHash = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, sha256: Schema.String }),
  Result: KeptIdSchema,
  execute: ({ conversationId, sha256 }) =>
    Database.use((db) =>
      db
        .select({ id: attachment.id })
        .from(attachment)
        .where(and(eq(attachment.conversationId, conversationId), eq(attachment.sha256, sha256))),
    ),
});

const insertFile = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    sha256: Schema.String,
    contentType: Schema.Literals(Object.values(CODING_AGENT_ATTACHMENT_TYPE)),
    width: Schema.NullOr(Schema.Int),
    height: Schema.NullOr(Schema.Int),
    bytes: Schema.Uint8Array,
    now: Schema.Date,
  }),
  Result: KeptIdSchema,
  execute: ({ now, bytes, ...row }) =>
    Database.use((db) =>
      db
        .insert(attachment)
        .values({ ...row, bytes, byteCount: bytes.byteLength, createdAt: now })
        .onConflictDoNothing({ target: [attachment.conversationId, attachment.sha256] })
        .returning({ id: attachment.id }),
    ),
});

const findKept = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    ids: Schema.Array(Schema.String),
    textOnly: Schema.Boolean,
  }),
  Result: Schema.Struct({ id: Schema.String, bytes: Schema.Uint8Array }),
  execute: ({ conversationId, ids, textOnly }) =>
    Database.use((db) =>
      db
        .select({ id: attachment.id, bytes: attachment.bytes })
        .from(attachment)
        .where(
          and(
            eq(attachment.conversationId, conversationId),
            inArray(attachment.id, [...ids]),
            textOnly ? eq(attachment.contentType, CODING_AGENT_ATTACHMENT_TYPE.TEXT) : undefined,
          ),
        ),
    ),
});

const InlineRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  conversationId: Schema.String,
  parts: PartsColumnSchema,
});

/**
 * The next rows past `after` that carry a file part over a `data:` URL, by
 * id, locked for the batch's transaction; a row a writer holds is passed
 * over and found by a later pass.
 */
const findInlineRows = SqlSchema.findAll({
  Request: Schema.Struct({ after: Schema.NullOr(Schema.String), limit: Schema.Int }),
  Result: InlineRowSchema,
  execute: ({ after, limit }) =>
    Database.use((db) =>
      db
        .select({
          id: messages.id,
          userId: messages.userId,
          conversationId: messages.conversationId,
          parts: messages.parts,
        })
        .from(messages)
        .where(after === null ? carriesInlineFile : and(carriesInlineFile, gt(messages.id, after)))
        .orderBy(asc(messages.id))
        .limit(limit)
        .for("update", { skipLocked: true }),
    ),
});

const rewriteParts = SqlSchema.void({
  Request: Schema.Struct({ id: Schema.String, parts: PartsColumnSchema }),
  execute: ({ id, parts }) =>
    Database.use((db) => db.update(messages).set({ parts }).where(eq(messages.id, id))),
});

const countInline = SqlSchema.findAll({
  Request: Schema.Void,
  Result: Schema.Struct({ rows: Schema.Number, parts: Schema.NullOr(Schema.Number) }),
  execute: () =>
    Database.use((db) =>
      db
        .select({
          rows: count(),
          parts:
            sql<number>`sum(jsonb_array_length(jsonb_path_query_array(${messages.parts}, ${INLINE_FILE_PARTS}::jsonpath)))`.mapWith(
              Number,
            ),
        })
        .from(messages)
        .where(carriesInlineFile),
    ),
});

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The file a part carries inline: its bytes and type; nothing for a part
 * that is no file over a `data:` URL, of a type a line may carry, within
 * what a conversation's row may hold.
 */
function inlineFileOf(part: Part): LineFile | undefined {
  if (!isFileUIPart(part)) return undefined;
  const inline = INLINE_URL.exec(part.url);
  const [, mediaType = "", base64 = ""] = inline ?? [];
  if (inline === null || !isFileType(mediaType) || mediaType !== part.mediaType) return undefined;
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  if (bytes.byteLength > CONVERSATION_PICTURE_BOUNDS.MAX_BYTES) return undefined;
  return { bytes, contentType: mediaType };
}

/**
 * A picture's size where its bytes are the type it travelled as, so a tool
 * that later answers the same bytes finds a row it may name; nothing for
 * any other file, which no tool's picture is.
 */
function sizeOf(file: LineFile): { width: number | null; height: number | null } {
  const sniffed = IMAGE_TYPES.has(file.contentType) ? sniffImageType(file.bytes) : undefined;
  const size = sniffed === file.contentType ? imageDimensions(file.bytes, sniffed) : undefined;
  return { width: size?.width ?? null, height: size?.height ?? null };
}

/** Keeps one file beside the conversation, answering its row: the one already kept for the same bytes, or a new one. */
function keepLineFile(target: ConversationTarget, file: LineFile): TaskStoreEffect<string> {
  return Effect.gen(function* () {
    const { conversationId } = target;
    const sha256 = sha256Hex(file.bytes);
    const held = yield* findByHash({ conversationId, sha256 });
    if (Option.isSome(held)) return held.value.id;
    const now = yield* DateTime.nowAsDate;
    const [inserted] = yield* insertFile({
      userId: target.userId,
      conversationId,
      sha256,
      contentType: file.contentType,
      ...sizeOf(file),
      bytes: file.bytes,
      now,
    });
    if (inserted !== undefined) return inserted.id;
    // A write that raced another to the same bytes reads the winner's row.
    const raced = yield* findByHash({ conversationId, sha256 });
    if (Option.isSome(raced)) return raced.value.id;
    return yield* Effect.die(new Error("a kept file's row vanished under its own hash"));
  });
}

/**
 * A user row's parts as the store keeps them: each file part over a
 * `data:` URL kept beside the conversation and named by its row, every
 * other part as it stands. A part past what a row may hold stays inline.
 */
export function keptLineParts(target: ConversationTarget, parts: Parts): TaskStoreEffect<Parts> {
  return Effect.forEach(parts, (part) => {
    const file = inlineFileOf(part);
    if (file === undefined || !isFileUIPart(part)) return Effect.succeed(part);
    return Effect.map(
      keepLineFile(target, file),
      (id): Part => ({ ...part, url: lineFileUrl(id) }),
    );
  });
}

/** The base64 of the kept rows the parts' file parts name, by row id, read from the conversation alone; text files alone where `textOnly`. */
function keptBase64(
  conversationId: string,
  parts: readonly Part[],
  textOnly: boolean,
): TaskStoreEffect<ReadonlyMap<string, string>> {
  const ids = parts.flatMap((part) => {
    if (!isFileUIPart(part)) return [];
    if (textOnly && part.mediaType !== CODING_AGENT_ATTACHMENT_TYPE.TEXT) return [];
    const id = lineFileIdOf(part.url);
    return id === undefined ? [] : [id];
  });
  if (ids.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findKept({ conversationId, ids, textOnly }),
    (rows) => new Map(rows.map((row) => [row.id, Buffer.from(row.bytes).toString("base64")])),
  );
}

/**
 * The base64 of the text files the rows' parts name by their kept row, by
 * that row's id: what eve's receipt of a line inlines, which the line is
 * matched by.
 */
export function keptLineTexts(
  conversationId: string,
  parts: readonly Part[],
): TaskStoreEffect<ReadonlyMap<string, string>> {
  return keptBase64(conversationId, parts, true);
}

/** The base64 of every file the parts name by its kept row, by that row's id: what a replay attaches again. */
export function keptLineFiles(
  conversationId: string,
  parts: readonly Part[],
): TaskStoreEffect<ReadonlyMap<string, string>> {
  return keptBase64(conversationId, parts, false);
}

/** What one batch of the backfill did: the rows it rewrote, the rows it read, and the last row it read, which the next batch starts after. */
export interface InlineLineFilesMoved {
  readonly moved: number;
  readonly read: number;
  readonly last: string | undefined;
}

/**
 * One batch of the backfill, in a transaction of its own: the next rows
 * past `after` that carry a file part over a `data:` URL, each with its
 * files kept beside its conversation and its parts rewritten to name them.
 * Running it again over a row already moved finds nothing to move, and a
 * file kept twice is the one row its hash names.
 */
export function moveInlineLineFiles(
  after: string | undefined,
): TaskStoreEffect<InlineLineFilesMoved> {
  const batch = Effect.gen(function* () {
    const rows = yield* findInlineRows({
      after: after ?? null,
      limit: LINE_FILE_BACKFILL.BATCH_ROWS,
    });
    let moved = 0;
    for (const row of rows) {
      const target: ConversationTarget = { userId: row.userId, conversationId: row.conversationId };
      const { parts } = row;
      const kept = yield* keptLineParts(target, parts);
      if (kept.every((part, index) => part === parts[index])) continue;
      yield* rewriteParts({ id: row.id, parts: kept });
      moved += 1;
    }
    return { moved, read: rows.length, last: rows.at(-1)?.id };
  });
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(batch));
}

/** How many user rows still carry a file part over a `data:` URL, and how many such parts they carry. */
export function countInlineLineFiles(): TaskStoreEffect<{
  readonly rows: number;
  readonly parts: number;
}> {
  return Effect.map(countInline(undefined), ([counted]) => ({
    rows: counted?.rows ?? 0,
    parts: counted?.parts ?? 0,
  }));
}
