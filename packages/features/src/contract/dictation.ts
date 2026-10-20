/**
 * dictation.ts -- a clip dictated into a message box (`dictation-wire.ts`), answered with its words.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { dictationAnswerSchema, dictationRequestSchema } from "../dictation-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { exactInput, hostedProcedure } from "./base.js";

export const dictationContract = {
  transcribe: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DICTATION }))
    .input(exactInput(dictationRequestSchema))
    .output(EffectSchema.flip(dictationAnswerSchema)),
};
