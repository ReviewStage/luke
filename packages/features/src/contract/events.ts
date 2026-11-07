/**
 * events.ts -- the desktop's product analytics batch (`analytics/product-events.ts`), as one procedure.
 *
 * The batch is read by the one allowlist reader both sides run,
 * `productEventBatchFromWire`, which builds each event from its own
 * property allowlist rather than from what arrived; so the procedure takes
 * the body as it came and the handler reads it. A batch it took is answered
 * 202, as it always was.
 *
 * Beyond what any procedure may refuse, a batch past the analytics
 * project's quota is refused as quota exhausted, and one the project did not
 * take, or never answered, as an upstream error (`events.ts`); a deployment
 * that names no project is unavailable.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { productEventsAnswerSchema } from "../analytics/product-events.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import { bodyCap, declaredProcedure, refuses } from "./base.js";

/** Bigger than a full batch of allowlisted events can be, and refused before it is read. */
export const EVENTS_MAXIMUM_BODY_BYTES = 16_384;

/** The status a batch the service took is answered with. */
const ACCEPTED_STATUS = 202;

export const eventsContract = {
  record: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.QUOTA_EXHAUSTED, HOSTED_API_ERROR.UPSTREAM_ERROR))
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
