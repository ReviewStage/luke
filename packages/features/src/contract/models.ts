/**
 * models.ts -- the models a coding agent may run on (`models-wire.ts`), as one procedure.
 *
 * It refuses only as any procedure may (`ANY_PROCEDURE_REFUSALS`): a
 * bearer not taken, and a catalog or store that could not answer, so it is
 * built from `declaredProcedure` as it stands.
 *
 * The output is the wire schema flipped, so oRPC's output check encodes the
 * handler's value into the bytes the wire carries (`packages/service/src/orpc/base.ts`).
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { modelsAnswerSchema } from "../models-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { declaredProcedure } from "./base.js";

export const modelsContract = {
  list: declaredProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.MODELS }))
    .output(EffectSchema.flip(modelsAnswerSchema)),
};
