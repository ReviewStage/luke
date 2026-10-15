import { Schema as EffectSchema, Result } from "effect";
import { Base64 } from "effect/encoding";
import { sniffImageType } from "./image-signature.js";

/**
 * picture-wire.ts -- a picture Luke keeps for a reader: the image types it may be, its byte bound, and the one reading of the `data:` URL a picture is sent as.
 *
 * A picture is re-encoded on the Mac to at most `PICTURE_BOUNDS.MAX_BYTES`
 * and sent as a `data:` URL of one of `PICTURE_TYPE`, as a workspace's
 * photo is; the service keeps its bytes and serves them under the type they
 * were sniffed to be. A plan's pictures (`plan-attachment-wire.ts`) are one
 * use; nothing here names what a picture belongs to. The bytes must be the
 * image the label names, because every reader draws them as one.
 */

/** The image types a picture may be: sent as a `data:` URL of one, kept as its bytes, served under it. */
export const PICTURE_TYPE = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
} as const;

export type PictureType = (typeof PICTURE_TYPE)[keyof typeof PICTURE_TYPE];

/** A picture's media type as the wire carries it. */
export const pictureTypeSchema = EffectSchema.Literals(Object.values(PICTURE_TYPE));

export const PICTURE_BOUNDS = {
  /**
   * The most bytes one picture may hold, decoded: the Inbox's and the
   * message box's bound, which a screenshot the Mac re-encoded as WebP sits
   * well under.
   */
  MAX_BYTES: 1_500_000,
} as const;

/** A picture as a `data:` URL spells it: its media type, then its bytes in base64. */
const PICTURE_DATA_URL = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/u;

const isPictureType = EffectSchema.is(pictureTypeSchema);

/** A picture, as its bytes under its media type. */
export interface Picture {
  readonly contentType: PictureType;
  readonly bytes: Uint8Array;
}

/**
 * The picture a `data:` URL holds, where its type is one of `PICTURE_TYPE`
 * and its bytes read as that image; nothing for any other text.
 */
export function pictureOfDataUrl(text: string): Picture | undefined {
  const [, contentType, base64] = PICTURE_DATA_URL.exec(text) ?? [];
  if (contentType === undefined || base64 === undefined || !isPictureType(contentType)) {
    return undefined;
  }
  const bytes = Base64.decode(base64);
  if (Result.isFailure(bytes) || sniffImageType(bytes.success) !== contentType) return undefined;
  return { contentType, bytes: bytes.success };
}

/** A picture to keep, as the `data:` URL it is sent as: one `pictureOfDataUrl` reads, within the byte bound. */
export const pictureDataUrlSchema = EffectSchema.String.check(
  EffectSchema.makeFilter((text: string) => {
    const picture = pictureOfDataUrl(text);
    return picture !== undefined && picture.bytes.length <= PICTURE_BOUNDS.MAX_BYTES;
  }),
);
