import { Schema as EffectSchema } from "effect";
import { AGENT_ATTACHMENT_TYPE } from "./agent-wire.js";
import { pictureDataUrlSchema } from "./picture-wire.js";
import { wireUuidSchema } from "./service-wire.js";
import { WEBM_TYPE } from "./video-signature.js";

export const DESCRIPTION_ATTACHMENT_BOUNDS = {
  MAX_PER_DESCRIPTION: 100,
  MAX_VIDEOS_PER_DESCRIPTION: 10,
} as const;

export const DESCRIPTION_ATTACHMENT_TYPE = {
  ...AGENT_ATTACHMENT_TYPE,
  WEBM: WEBM_TYPE,
} as const;

export const descriptionAttachmentTypeSchema = EffectSchema.Literals(
  Object.values(DESCRIPTION_ATTACHMENT_TYPE),
);

export const descriptionAttachmentRequestSchema = EffectSchema.Struct({
  picture: pictureDataUrlSchema,
});

export const DESCRIPTION_ATTACHMENT_REFUSAL = {
  TOO_MANY: "too-many",
  TOO_MANY_VIDEOS: "too-many-videos",
} as const;

export const DESCRIPTION_ATTACHMENT_STATUS = {
  KEPT: 201,
  REFUSED: 200,
} as const;

export const descriptionAttachmentAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ id: wireUuidSchema }),
  EffectSchema.Struct({
    refused: EffectSchema.Literals(Object.values(DESCRIPTION_ATTACHMENT_REFUSAL)),
  }),
]);
