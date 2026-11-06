import { LEGACY_APP_WORD } from "@repo/wire";
import { Schema as EffectSchema, Option } from "effect";
import { INBOX_IMAGE_TYPE } from "./inbox-wire.js";
import { WEBM_TYPE } from "./video-signature.js";

export const CONVERSATION_PICTURE_BOUNDS = {
  MAX_BYTES: 4_000_000,
  MAX_BYTES_PER_CONVERSATION: 200_000_000,
  MAX_PER_CALL: 20,
} as const;

export const PICTURE_OMISSION = {
  TOO_LARGE: "too-large",
  LIMIT: "limit",
  UNSUPPORTED: "unsupported",
} as const;

export type PictureOmission = (typeof PICTURE_OMISSION)[keyof typeof PICTURE_OMISSION];

export const CONVERSATION_MEDIA_TYPE = {
  ...INBOX_IMAGE_TYPE,
  WEBM: WEBM_TYPE,
} as const;

export type ConversationMediaType =
  (typeof CONVERSATION_MEDIA_TYPE)[keyof typeof CONVERSATION_MEDIA_TYPE];

export const conversationMediaTypeSchema = EffectSchema.Literals(
  Object.values(CONVERSATION_MEDIA_TYPE),
);

export function isVideoType(
  mediaType: ConversationMediaType,
): mediaType is typeof CONVERSATION_MEDIA_TYPE.WEBM {
  return mediaType === CONVERSATION_MEDIA_TYPE.WEBM;
}

export const keptPictureSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  mediaType: conversationMediaTypeSchema,
  width: EffectSchema.Number,
  height: EffectSchema.Number,
  byteCount: EffectSchema.Number,
});

export type KeptPicture = typeof keptPictureSchema.Type;

export const KEPT_IMAGE_PROVIDER_KEY = "app";

const keptImageSchema = EffectSchema.Union([
  EffectSchema.Struct({ attachmentId: EffectSchema.String }),
  EffectSchema.Struct({ omitted: EffectSchema.Literals(Object.values(PICTURE_OMISSION)) }),
]);

const keptImageMetadataSchema = EffectSchema.Union([
  EffectSchema.Struct({ [KEPT_IMAGE_PROVIDER_KEY]: keptImageSchema }),
  EffectSchema.Struct({ [LEGACY_APP_WORD]: keptImageSchema }),
]);

const readKeptImageMetadata = EffectSchema.decodeUnknownOption(keptImageMetadataSchema);

export function keptImageMetadataOf(
  providerMetadata: unknown,
): typeof keptImageSchema.Type | undefined {
  const read = Option.getOrUndefined(readKeptImageMetadata(providerMetadata));
  if (read === undefined) return undefined;
  return KEPT_IMAGE_PROVIDER_KEY in read ? read[KEPT_IMAGE_PROVIDER_KEY] : read[LEGACY_APP_WORD];
}

export function keptPictureIdOf(providerMetadata: unknown): string | undefined {
  const kept = keptImageMetadataOf(providerMetadata);
  return kept !== undefined && "attachmentId" in kept ? kept.attachmentId : undefined;
}
