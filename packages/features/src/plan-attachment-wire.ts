import { Schema as EffectSchema } from "effect";
import { CODING_AGENT_ATTACHMENT_TYPE } from "./coding-agent-wire.js";
import { pictureDataUrlSchema } from "./picture-wire.js";
import { wireUuidSchema } from "./service-wire.js";
import { WEBM_TYPE } from "./video-signature.js";

/**
 * plan-attachment-wire.ts -- a plan's pictures on the wire: how many a plan may hold, what an upload carries, and what it answers.
 *
 * A picture is pasted, dropped, or chosen into a plan's text on the Mac and
 * sent as one picture (`picture-wire.ts`), as is a video an agent recorded,
 * added from the file viewer. The service keeps its bytes beside the plan
 * and answers the id the text then names it by (`plan-attachment-link.ts`).
 */

export const PLAN_ATTACHMENT_BOUNDS = {
  /** The most pictures one plan may hold, saved or not, so a plan's pictures stay a few dozen megabytes at most. */
  MAX_PER_PLAN: 100,
  /** The most of those that may be videos, each up to four times a picture's bytes, so a plan's videos stay a few dozen megabytes too. */
  MAX_VIDEOS_PER_PLAN: 10,
} as const;

/** The types a plan's attachment is served as: a picture's or a video's its text names, or any a comment's file may be. */
export const PLAN_ATTACHMENT_TYPE = {
  ...CODING_AGENT_ATTACHMENT_TYPE,
  WEBM: WEBM_TYPE,
} as const;

/** A plan's attachment's media type as the wire carries it. */
export const planAttachmentTypeSchema = EffectSchema.Literals(Object.values(PLAN_ATTACHMENT_TYPE));

/** An upload (POST): the one picture or video, as a `data:` URL. */
export const planAttachmentRequestSchema = EffectSchema.Struct({
  picture: pictureDataUrlSchema,
});

/** Why an upload kept nothing, answered in band. */
export const PLAN_ATTACHMENT_REFUSAL = {
  /** The plan already holds `PLAN_ATTACHMENT_BOUNDS.MAX_PER_PLAN` pictures. */
  TOO_MANY: "too-many",
  /** The upload is a video, and the plan already holds `PLAN_ATTACHMENT_BOUNDS.MAX_VIDEOS_PER_PLAN` videos. */
  TOO_MANY_VIDEOS: "too-many-videos",
} as const;

/** The status an upload is answered with: 201 where it kept the picture, 200 where it refused in band. */
export const PLAN_ATTACHMENT_STATUS = {
  KEPT: 201,
  REFUSED: 200,
} as const;

/** What an upload answers: the kept picture's id, which the text then names, or why nothing was kept. */
export const planAttachmentAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ id: wireUuidSchema }),
  EffectSchema.Struct({
    refused: EffectSchema.Literals(Object.values(PLAN_ATTACHMENT_REFUSAL)),
  }),
]);
