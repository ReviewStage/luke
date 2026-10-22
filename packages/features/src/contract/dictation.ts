/**
 * dictation.ts -- a clip dictated into a message box (`dictation-wire.ts`), answered with its words.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { base64Chars } from "../coding-agent-wire.js";
import {
  DICTATION_BOUNDS,
  dictationAnswerSchema,
  dictationRequestSchema,
} from "../dictation-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

/** Room for the words and the JSON around the clip: fifty words of a hundred characters, each escaped six bytes to a character, fit with room to spare. */
const ENVELOPE_BYTES = 64 * 1_024;

/** A body is a clip in base64 and its words, each held to its bound, so one past this is not one. */
const BODY_BYTES = base64Chars(DICTATION_BOUNDS.MAX_AUDIO_BYTES) + ENVELOPE_BYTES;

export const dictationContract = {
  transcribe: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DICTATION }))
    .input(exactInput(dictationRequestSchema))
    .output(EffectSchema.flip(dictationAnswerSchema)),
};
