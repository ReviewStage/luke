import { Schema as EffectSchema, Option } from "effect";
import { INBOX_IMAGE_TYPE } from "./inbox-wire.js";
import { WEBM_TYPE } from "./video-signature.js";

/**
 * conversation-picture-wire.ts -- a picture a transcript names: how a tool's stored output or a line's image names one the service kept beside the conversation, and why one was not kept.
 *
 * A tool may answer a model with a picture, as an integration's MCP tool
 * answers an image block. The model sees the picture where eve hands it
 * over; the record keeps it once, as a row beside the conversation
 * (`attachment`), and the stored output names that row in the
 * picture's place, never the bytes, which would otherwise ride every read,
 * journal amend, and long poll of the transcript. A picture the service did
 * not keep is named by why, with its size, so a reader can say so. An image
 * a coding agent is handed on a line is kept the same way, and its file part
 * in the row names the row under the provider key below
 * (`keptPictureIdOf`).
 *
 * The bounds are the policy, held here alone so moving one is one edit:
 * the byte bound is also the check on the table's column, so moving it is
 * that edit and the migration `pnpm db:generate` writes for it.
 */

/**
 * The most a conversation keeps of the pictures its tools answered. A
 * picture is bounded under the 4.5 MB a Vercel function may answer, since
 * its read serves the bytes whole; a conversation is bounded by bytes
 * rather than by count, as the tools a developer already uses bound theirs
 * by storage, so an agent that shows many small screenshots is never cut
 * off before one that shows a few large ones.
 */
export const CONVERSATION_PICTURE_BOUNDS = {
  /** The most bytes one picture is kept at, as the tool answered it; a larger one is named, not kept. */
  MAX_BYTES: 4_000_000,
  /** The most bytes of pictures one conversation keeps; a picture past them is named, not kept. */
  MAX_BYTES_PER_CONVERSATION: 200_000_000,
  /** The most pictures one `show_image` call shows, as one set. */
  MAX_PER_CALL: 20,
} as const;

/** Why a picture a tool answered was not kept. */
export const PICTURE_OMISSION = {
  /** Its bytes were over `MAX_BYTES`. */
  TOO_LARGE: "too-large",
  /** Keeping it would take the conversation past `MAX_BYTES_PER_CONVERSATION`. */
  LIMIT: "limit",
  /** Its bytes are no PNG, JPEG, or WebP whose header states its size. */
  UNSUPPORTED: "unsupported",
} as const;

export type PictureOmission = (typeof PICTURE_OMISSION)[keyof typeof PICTURE_OMISSION];

/**
 * What a transcript's picture may be: one of the three pictures, or a WebM
 * an agent recorded of what it did, shown as a picture is and kept under the
 * same bounds, which the transcript plays where it would draw a picture.
 */
export const CONVERSATION_MEDIA_TYPE = {
  ...INBOX_IMAGE_TYPE,
  WEBM: WEBM_TYPE,
} as const;

export type ConversationMediaType =
  (typeof CONVERSATION_MEDIA_TYPE)[keyof typeof CONVERSATION_MEDIA_TYPE];

/** A transcript picture's media type as the wire carries it. */
export const conversationMediaTypeSchema = EffectSchema.Literals(
  Object.values(CONVERSATION_MEDIA_TYPE),
);

/** Whether a transcript's picture is a video, played rather than drawn. */
export function isVideoType(
  mediaType: ConversationMediaType,
): mediaType is typeof CONVERSATION_MEDIA_TYPE.WEBM {
  return mediaType === CONVERSATION_MEDIA_TYPE.WEBM;
}

/** A kept picture as a stored output names it: the row, the type its bytes were sniffed to be, its size in pixels, and its size in bytes. */
export const keptPictureSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  mediaType: conversationMediaTypeSchema,
  width: EffectSchema.Number,
  height: EffectSchema.Number,
  byteCount: EffectSchema.Number,
});

export type KeptPicture = typeof keptPictureSchema.Type;

/**
 * The provider key an image file part of a coding agent's line names what
 * was kept of its picture under, which no provider reads
 * (`packages/database/src/models/attached-file-parts.ts`).
 */
export const KEPT_IMAGE_PROVIDER_KEY = "luke";

/** What an image file part names of its picture under that key: the attachment it was kept as, or why it was not kept. */
export const keptImageMetadataSchema = EffectSchema.Struct({
  [KEPT_IMAGE_PROVIDER_KEY]: EffectSchema.Union([
    EffectSchema.Struct({ attachmentId: EffectSchema.String }),
    EffectSchema.Struct({ omitted: EffectSchema.Literals(Object.values(PICTURE_OMISSION)) }),
  ]),
});

const readKeptImageMetadata = EffectSchema.decodeUnknownOption(keptImageMetadataSchema);

/** The id of the picture an image file part's provider metadata names it kept as; none where it names none. */
export function keptPictureIdOf(providerMetadata: unknown): string | undefined {
  const kept = Option.getOrUndefined(readKeptImageMetadata(providerMetadata))?.[
    KEPT_IMAGE_PROVIDER_KEY
  ];
  return kept !== undefined && "attachmentId" in kept ? kept.attachmentId : undefined;
}
