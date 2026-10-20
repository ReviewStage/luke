/**
 * factory.ts -- a workspace's Factory world (`factory-world-wire.ts`), read whole for a member of it.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { factoryWorldAnswerSchema, factoryWorldRequestSchema } from "../factory-world-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

/** The most a request body may hold: a workspace id. */
const BODY_BYTES = 1_024;

export const factoryContract = {
  world: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.FACTORY_WORLD }))
    .input(exactInput(factoryWorldRequestSchema))
    .output(EffectSchema.flip(factoryWorldAnswerSchema)),
};
