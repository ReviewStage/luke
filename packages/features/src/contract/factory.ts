/**
 * factory.ts -- a workspace's Factory world (`factory-world-wire.ts`), read whole for a member of it.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { factoryWorldAnswerSchema, factoryWorldRequestSchema } from "../factory-world-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { exactInput, hostedProcedure } from "./base.js";

export const factoryContract = {
  world: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.FACTORY_WORLD }))
    .input(exactInput(factoryWorldRequestSchema))
    .output(EffectSchema.flip(factoryWorldAnswerSchema)),
};
