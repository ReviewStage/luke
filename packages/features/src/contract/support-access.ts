/**
 * support-access.ts -- the member's grant of support access (`account-wire.ts`), as procedures: granted and revoked under the caller's own session.
 *
 * Both run through the auth service's own support-access endpoints, which
 * take a session, so the service reads its caller from the session the
 * request carries, the Mac's signed bearer or a browser's cookie, rather
 * than the account's bearer. Neither carries a body.
 *
 * Beyond what any procedure may refuse, each refuses as the auth service's
 * member writes are read (`workspace-access.ts`'s `pluginCallOrRefused`):
 * a grant the plugin refuses, such as one to a support sign-in itself, as not
 * permitted, and a refusal it codes as an invitation's as already invited.
 * A service from before the path answers it as not found.
 *
 * The output is the wire schema flipped, so oRPC's output check encodes the
 * handler's value into the bytes the wire carries (`packages/service/src/orpc/base.ts`).
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { supportAccessAnswerSchema } from "../account-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import { declaredProcedure, refuses } from "./base.js";

/** A write of the grant: refused as the plugin refuses a member write, and not found on a service from before it. */
const supportAccessProcedure = declaredProcedure.errors(
  refuses(
    HOSTED_API_ERROR.NOT_PERMITTED,
    HOSTED_API_ERROR.ALREADY_INVITED,
    HOSTED_API_ERROR.NOT_FOUND,
  ),
);

export const supportAccessContract = {
  grant: supportAccessProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.ACCOUNT_SUPPORT_ACCESS }))
    .output(EffectSchema.flip(supportAccessAnswerSchema)),
  revoke: supportAccessProcedure
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: HOSTED_SERVICE_PATH.ACCOUNT_SUPPORT_ACCESS }))
    .output(EffectSchema.flip(supportAccessAnswerSchema)),
};
