/**
 * dictation.ts -- a clip dictated into a message box (`dictation-wire.ts`), answered with its words.
 *
 * Beyond what any procedure may refuse, a clip is refused where the account
 * saved no OpenAI key to hear it on.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { base64Chars } from "../agent-wire.js";
import {
  DICTATION_BOUNDS,
  dictationAnswerSchema,
  dictationRequestSchema,
} from "../dictation-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** Room for the words and the JSON around the clip: fifty words of a hundred characters, each escaped six bytes to a character, fit with room to spare. */
const ENVELOPE_BYTES = 64 * 1_024;

/** A body is a clip in base64 and its words, each held to its bound, so one past this is not one. */
const BODY_BYTES = base64Chars(DICTATION_BOUNDS.MAX_AUDIO_BYTES) + ENVELOPE_BYTES;

export const dictationContract = {
  transcribe: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.OPENAI_KEY_MISSING))
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DICTATION }))
    .input(exactInput(dictationRequestSchema))
    .output(EffectSchema.flip(dictationAnswerSchema)),
};
