import { Schema as EffectSchema, Result } from "effect";
import { Base64 } from "effect/encoding";
import { INBOX_BOUNDS, INBOX_IMAGE_TYPE, type InboxImageType } from "./inbox-wire.js";
import { sniffMediaType } from "./media-signature.js";
import { WEBM_TYPE, webmDimensions } from "./video-signature.js";

/**
 * picture-wire.ts -- a picture Luke keeps for a reader: the types it may be, its byte bounds, and the one reading of the `data:` URL a picture is sent as.
 *
 * A picture is re-encoded on the Mac to at most `PICTURE_BOUNDS.MAX_BYTES`
 * and sent as a `data:` URL of one of `PICTURE_TYPE`, as a workspace's
 * photo is; the service keeps its bytes and serves them under the type they
 * were sniffed to be. A WebM an agent recorded of what it did is kept the
 * same way, as it is, never re-encoded, and played where a picture would be
 * drawn. A plan's pictures (`plan-attachment-wire.ts`) are one use; nothing
 * here names what a picture belongs to. The bytes must be the image or the
 * video the label names, because every reader draws or plays them as one.
 * Note that `PICTURE_TYPE` stays the image types alone, because a reader
 * that hands a picture to a model as an image (`look_at_picture`) must
 * never be handed a video.
 */

/**
 * The image types a picture may be: sent as a `data:` URL of one, kept as its
 * bytes, served under it. They are the inbox's image types, the three
 * `sniffImageType` reads, which a coding agent's attachments name first.
 */
export const PICTURE_TYPE = INBOX_IMAGE_TYPE;

export type PictureType = InboxImageType;

/** An image picture's media type as the wire carries it. */
export const pictureTypeSchema = EffectSchema.Literals(Object.values(PICTURE_TYPE));

/** The types a kept picture may be: one of the images, or a WebM an agent recorded, played rather than drawn. */
export const PICTURE_MEDIA_TYPE = {
  ...PICTURE_TYPE,
  WEBM: WEBM_TYPE,
} as const;

export type PictureMediaType = (typeof PICTURE_MEDIA_TYPE)[keyof typeof PICTURE_MEDIA_TYPE];

/** A kept picture's media type as the wire carries it: an image's or a video's. */
export const pictureMediaTypeSchema = EffectSchema.Literals(Object.values(PICTURE_MEDIA_TYPE));

export const PICTURE_BOUNDS = {
  /**
   * The most bytes one picture may hold, decoded: the Inbox's and the
   * message box's bound, which a screenshot the Mac re-encoded as WebP sits
   * well under.
   */
  MAX_BYTES: 1_500_000,
  /** The most bytes one video may hold, decoded: the bound the inbox and the chat keep a recording under. */
  MAX_VIDEO_BYTES: INBOX_BOUNDS.MAX_VIDEO_BYTES,
  /**
   * The most bytes one video sent as a `data:` URL may hold, decoded. Note
   * that this is under `MAX_VIDEO_BYTES`, because base64 spells three bytes
   * in four characters and the request carrying it must stay under the 4.5
   * MB a Vercel function may be sent; a video read on the service, as an
   * agent's from its sandbox, is held to `MAX_VIDEO_BYTES` alone.
   */
  MAX_SENT_VIDEO_BYTES: 3_300_000,
} as const;

/** A picture as a `data:` URL spells it: its media type, then its bytes in base64. */
const PICTURE_DATA_URL = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/u;

const isPictureMediaType = EffectSchema.is(pictureMediaTypeSchema);

/** A picture, as its bytes under its media type: an image, or a video. */
export interface Picture {
  readonly contentType: PictureMediaType;
  readonly bytes: Uint8Array;
}

/** Whether a picture is a video, played rather than drawn, and never handed to a model as an image. */
export function isVideoPicture(picture: Picture): boolean {
  return picture.contentType === PICTURE_MEDIA_TYPE.WEBM;
}

/**
 * The picture a `data:` URL holds, where its type is one of
 * `PICTURE_MEDIA_TYPE` and its bytes read as that image, or as a WebM that
 * states its size, as an inbox post's recording must; nothing for any other
 * text.
 */
export function pictureOfDataUrl(text: string): Picture | undefined {
  const [, contentType, base64] = PICTURE_DATA_URL.exec(text) ?? [];
  if (contentType === undefined || base64 === undefined || !isPictureMediaType(contentType)) {
    return undefined;
  }
  const bytes = Base64.decode(base64);
  if (Result.isFailure(bytes) || sniffMediaType(bytes.success) !== contentType) return undefined;
  const picture: Picture = { contentType, bytes: bytes.success };
  if (isVideoPicture(picture) && webmDimensions(picture.bytes) === undefined) return undefined;
  return picture;
}

/** The most bytes a picture sent as a `data:` URL may hold: an image's bound, or a sent video's. */
function sentBytesOf(picture: Picture): number {
  return isVideoPicture(picture) ? PICTURE_BOUNDS.MAX_SENT_VIDEO_BYTES : PICTURE_BOUNDS.MAX_BYTES;
}

/** A picture to keep, as the `data:` URL it is sent as: one `pictureOfDataUrl` reads, within its type's byte bound. */
export const pictureDataUrlSchema = EffectSchema.String.check(
  EffectSchema.makeFilter((text: string) => {
    const picture = pictureOfDataUrl(text);
    return picture !== undefined && picture.bytes.length <= sentBytesOf(picture);
  }),
);
