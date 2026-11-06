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
