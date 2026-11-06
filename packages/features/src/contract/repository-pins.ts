import { HTTP_METHOD } from "@repo/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import {
  repositoryPinRequestSchema,
  repositoryPinsAnswerSchema,
  repositoryPinsWrittenSchema,
} from "../task-wire.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

const PIN_BODY_BYTES = 1_024;

export const repositoryPinsContract = {
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.REPOSITORY_PINS }))
    .output(EffectSchema.flip(repositoryPinsAnswerSchema)),
  set: hostedProcedure
    .meta(bodyCap(PIN_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.REPOSITORY_PINS }))
    .input(exactInput(repositoryPinRequestSchema))
    .output(EffectSchema.flip(repositoryPinsWrittenSchema)),
};
