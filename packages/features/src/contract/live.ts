/**
 * live.ts -- the reads the desktop follows over Neon Realtime (`live-wire.ts`), sealed for the caller's own account.
 *
 * One read today: what waits on the developer across the account, as the
 * address to subscribe at and one sealed statement per part of the account
 * inbox's answer. Its output is the wire schema flipped
 * (`packages/service/src/orpc/base.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { accountInboxLiveAnswerSchema } from "../live-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { hostedProcedure } from "./base.js";

export const liveContract = {
  inbox: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_INBOX }))
    .output(EffectSchema.flip(accountInboxLiveAnswerSchema)),
};
