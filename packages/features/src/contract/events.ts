/**
 * events.ts -- the desktop's product analytics batch (`analytics/product-events.ts`), as one procedure.
 *
 * The batch is read by the one allowlist reader both sides run,
 * `productEventBatchFromWire`, which builds each event from its own
 * property allowlist rather than from what arrived; so the procedure takes
 * the body as it came and the handler reads it. A batch it took is answered
 * 202, as it always was.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { productEventsAnswerSchema } from "../analytics/product-events.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, hostedProcedure } from "./base.js";

/** Bigger than a full batch of allowlisted events can be, and refused before it is read. */
export const EVENTS_MAXIMUM_BODY_BYTES = 16_384;

/** The status a batch the service took is answered with. */
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
