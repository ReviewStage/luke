import type { InboxImageType } from "./inbox-wire.js";

/**
 * conversation-picture-wire.ts -- a picture a transcript names: how a tool's stored output names one the service kept beside the conversation, and why one it answered was not kept.
 *
 * A tool may answer a model with a picture, as an integration's MCP tool
 * answers an image block. The model sees the picture where eve hands it
 * over; the record keeps it once, as a row beside the conversation
 * (`conversation_attachment`), and the stored output names that row in the
 * picture's place, never the bytes, which would otherwise ride every read,
 * journal amend, and long poll of the transcript. A picture the service did
 * not keep is named by why, with its size, so a reader can say so.
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

/** A kept picture as a stored output names it: the row, the type its bytes were sniffed to be, its size in pixels, and its size in bytes. */
export interface KeptPicture {
  readonly id: string;
  readonly mediaType: InboxImageType;
  readonly width: number;
  readonly height: number;
  readonly byteCount: number;
}
