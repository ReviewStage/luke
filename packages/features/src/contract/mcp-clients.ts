import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { MCP_CLIENT_QUERY, mcpClientIdSchema, mcpClientsAnswerSchema } from "../mcp-client-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { hostedProcedure } from "./base.js";

export const mcpClientsContract = {
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_MCP_CLIENTS }))
    .output(EffectSchema.flip(mcpClientsAnswerSchema)),
  revoke: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.DELETE,
        path: HOSTED_SERVICE_PATH.ACCOUNT_MCP_CLIENTS,
        inputStructure: "detailed",
      }),
    )
    .input(
      EffectSchema.Struct({
        query: EffectSchema.Struct({ [MCP_CLIENT_QUERY.CLIENT_ID]: mcpClientIdSchema }),
      }),
    )
    .output(EffectSchema.flip(mcpClientsAnswerSchema)),
};
