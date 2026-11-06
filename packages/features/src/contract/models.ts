import { HTTP_METHOD } from "@repo/wire";
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
