/**
 * repository-pins.ts -- the repositories the account pinned in the sidebar (`task-wire.ts`): read them, and pin or unpin one.
 *
 * A pin goes through the write receipt (`writeReceiptMiddleware`), so it
 * declares a write sent again under its key as already written beyond the
 * refusals any procedure may answer (`declaredProcedure`); one the store will
 * not keep is refused as an invalid request, which any procedure may answer.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import {
  repositoryPinRequestSchema,
  repositoryPinsAnswerSchema,
  repositoryPinsWrittenSchema,
} from "../task-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** A pin is a repository's name and a boolean, so a body past this is not one. */
const PIN_BODY_BYTES = 1_024;

export const repositoryPinsContract = {
  list: declaredProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.REPOSITORY_PINS }))
    .output(EffectSchema.flip(repositoryPinsAnswerSchema)),
  set: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.ALREADY_WRITTEN))
    .meta(bodyCap(PIN_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.REPOSITORY_PINS }))
    .input(exactInput(repositoryPinRequestSchema))
    .output(EffectSchema.flip(repositoryPinsWrittenSchema)),
};
