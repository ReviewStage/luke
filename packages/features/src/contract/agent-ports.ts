import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { listeningPortsAnswerSchema } from "../listening-ports-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { hostedProcedure } from "./base.js";

const agentParamsSchema = EffectSchema.Struct({ id: EffectSchema.String });

export const agentPortsContract = {
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${HOSTED_SERVICE_PATH.AGENTS}/{id}/ports` }))
    .input(agentParamsSchema)
    .output(EffectSchema.flip(listeningPortsAnswerSchema)),
};
