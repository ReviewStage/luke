/**
 * repository-pins.ts -- the repositories the account pinned in the sidebar (`task-wire.ts`): read them, and pin or unpin one.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { repositoryPinRequestSchema, repositoryPinsAnswerSchema } from "../task-wire.js";
import { exactInput, hostedProcedure } from "./base.js";

export const repositoryPinsContract = {
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.REPOSITORY_PINS }))
    .output(EffectSchema.flip(repositoryPinsAnswerSchema)),
  set: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.REPOSITORY_PINS }))
    .input(exactInput(repositoryPinRequestSchema))
    .output(EffectSchema.flip(repositoryPinsAnswerSchema)),
};
