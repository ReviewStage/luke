/**
 * models.ts -- the models a coding agent may run on (`models-wire.ts`), as one procedure.
 *
 * The output is the wire schema flipped, so oRPC's output check encodes the
 * handler's value into the bytes the wire carries (`packages/service/src/orpc/base.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { modelsAnswerSchema } from "../models-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { hostedProcedure } from "./base.js";

export const modelsContract = {
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.MODELS }))
    .output(EffectSchema.flip(modelsAnswerSchema)),
};
