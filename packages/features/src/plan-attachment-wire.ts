import { Schema as EffectSchema } from "effect";
import { pictureDataUrlSchema } from "./picture-wire.js";
import { wireUuidSchema } from "./service-wire.js";

/**
 * plan-attachment-wire.ts -- a plan's pictures on the wire: how many a plan may hold, what an upload carries, and what it answers.
 *
 * A picture is pasted, dropped, or chosen into a plan's text on the Mac and
 * sent as one picture (`picture-wire.ts`). The service keeps its bytes
 * beside the plan and answers the id the text then names it by
 * (`plan-attachment-link.ts`).
 */

export const PLAN_ATTACHMENT_BOUNDS = {
  /** The most pictures one plan may hold, saved or not, so a plan's pictures stay a few dozen megabytes at most. */
  MAX_PER_PLAN: 100,
} as const;

/** An upload (POST): the one picture, as a `data:` URL. */
export const planAttachmentRequestSchema = EffectSchema.Struct({
  picture: pictureDataUrlSchema,
});

/** Why an upload kept nothing, answered in band. */
export const PLAN_ATTACHMENT_REFUSAL = {
  /** The plan already holds `PLAN_ATTACHMENT_BOUNDS.MAX_PER_PLAN` pictures. */
  TOO_MANY: "too-many",
} as const;

/** What an upload answers: the kept picture's id, which the text then names, or why nothing was kept. */
export const planAttachmentAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ id: wireUuidSchema }),
  EffectSchema.Struct({
    refused: EffectSchema.Literals(Object.values(PLAN_ATTACHMENT_REFUSAL)),
  }),
]);
