import { HTTP_METHOD } from "@repo/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { base64Chars } from "../agent-wire.js";
import {
  DICTATION_BOUNDS,
  dictationAnswerSchema,
  dictationRequestSchema,
} from "../dictation-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

const ENVELOPE_BYTES = 64 * 1_024;

const BODY_BYTES = base64Chars(DICTATION_BOUNDS.MAX_AUDIO_BYTES) + ENVELOPE_BYTES;

export const dictationContract = {
  transcribe: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DICTATION }))
    .input(exactInput(dictationRequestSchema))
    .output(EffectSchema.flip(dictationAnswerSchema)),
};
