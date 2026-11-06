import { Schema as EffectSchema, Result } from "effect";
import { Base64 } from "effect/encoding";
import { INBOX_BOUNDS, INBOX_IMAGE_TYPE, type InboxImageType } from "./inbox-wire.js";
import { sniffMediaType } from "./media-signature.js";
import { WEBM_TYPE, webmDimensions } from "./video-signature.js";

export const PICTURE_TYPE = INBOX_IMAGE_TYPE;

export type PictureType = InboxImageType;

export const pictureTypeSchema = EffectSchema.Literals(Object.values(PICTURE_TYPE));

export const PICTURE_MEDIA_TYPE = {
  ...PICTURE_TYPE,
  WEBM: WEBM_TYPE,
} as const;

export type PictureMediaType = (typeof PICTURE_MEDIA_TYPE)[keyof typeof PICTURE_MEDIA_TYPE];

export const pictureMediaTypeSchema = EffectSchema.Literals(Object.values(PICTURE_MEDIA_TYPE));

export const PICTURE_BOUNDS = {
  MAX_BYTES: 1_500_000,
  MAX_VIDEO_BYTES: INBOX_BOUNDS.MAX_VIDEO_BYTES,
  MAX_SENT_VIDEO_BYTES: 3_300_000,
} as const;

const PICTURE_DATA_URL = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/u;

const isPictureMediaType = EffectSchema.is(pictureMediaTypeSchema);

export interface Picture {
  readonly contentType: PictureMediaType;
  readonly bytes: Uint8Array;
}

export function isVideoPicture(picture: Picture): boolean {
  return picture.contentType === PICTURE_MEDIA_TYPE.WEBM;
}

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

function sentBytesOf(picture: Picture): number {
  return isVideoPicture(picture) ? PICTURE_BOUNDS.MAX_SENT_VIDEO_BYTES : PICTURE_BOUNDS.MAX_BYTES;
}

export const pictureDataUrlSchema = EffectSchema.String.check(
  EffectSchema.makeFilter((text: string) => {
    const picture = pictureOfDataUrl(text);
    return picture !== undefined && picture.bytes.length <= sentBytesOf(picture);
  }),
);
