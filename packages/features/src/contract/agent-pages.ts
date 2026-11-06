import { HTTP_METHOD } from "@repo/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { pageFrameAnswerSchema } from "../page-frame.js";
import { taskPageVersionAnswerSchema, taskPagesAnswerSchema } from "../page-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { hostedProcedure } from "./base.js";

const PAGES_PATH = `${HOSTED_SERVICE_PATH.AGENTS}/{id}/pages` as const;

const agentParamsSchema = EffectSchema.Struct({ id: EffectSchema.String });

const agentPageVersionSchema = EffectSchema.Struct({
  ...agentParamsSchema.fields,
  page: EffectSchema.String,
  version: EffectSchema.String,
});

export const agentPagesContract = {
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: PAGES_PATH }))
    .input(agentParamsSchema)
    .output(EffectSchema.flip(taskPagesAnswerSchema)),
  version: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${PAGES_PATH}/{page}/versions/{version}` }))
    .input(agentPageVersionSchema)
    .output(EffectSchema.flip(taskPageVersionAnswerSchema)),
  frame: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.GET,
        path: `${PAGES_PATH}/{page}/versions/{version}/frame`,
        outputStructure: "detailed",
      }),
    )
    .input(agentPageVersionSchema)
    .output(EffectSchema.flip(pageFrameAnswerSchema)),
};
