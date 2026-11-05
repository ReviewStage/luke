/**
 * support-access.ts -- the member's grant of support access (`account-wire.ts`), as procedures: granted and revoked under the caller's own session.
 *
 * Both run through the auth service's own support-access endpoints, which
 * take a session, so the service reads its caller from the session the
 * request carries, the Mac's signed bearer or a browser's cookie, rather
 * than the account's bearer. Neither carries a body.
 *
 * The output is the wire schema flipped, so oRPC's output check encodes the
 * handler's value into the bytes the wire carries (`packages/service/src/orpc/base.ts`).
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { supportAccessAnswerSchema } from "../account-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { hostedProcedure } from "./base.js";

export const supportAccessContract = {
  grant: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.ACCOUNT_SUPPORT_ACCESS }))
    .output(EffectSchema.flip(supportAccessAnswerSchema)),
  revoke: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: HOSTED_SERVICE_PATH.ACCOUNT_SUPPORT_ACCESS }))
    .output(EffectSchema.flip(supportAccessAnswerSchema)),
};
