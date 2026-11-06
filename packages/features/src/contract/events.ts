import { HTTP_METHOD } from "@repo/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { productEventsAnswerSchema } from "../analytics/product-events.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, hostedProcedure } from "./base.js";

export const EVENTS_MAXIMUM_BODY_BYTES = 16_384;

const ACCEPTED_STATUS = 202;

export const eventsContract = {
  record: hostedProcedure
    .meta(bodyCap(EVENTS_MAXIMUM_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.EVENTS,
        successStatus: ACCEPTED_STATUS,
      }),
    )
    .input(EffectSchema.Unknown)
    .output(EffectSchema.flip(productEventsAnswerSchema)),
};
