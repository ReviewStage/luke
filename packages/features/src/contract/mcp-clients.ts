/**
 * mcp-clients.ts -- the outside MCP clients the account allowed (`mcp-client-wire.ts`), as procedures: read on the account's bearer, one revoked under the Mac's session.
 *
 * A revoke deletes the client's Allow through Better Auth's own consent
 * endpoint, which takes a session, so the service reads its caller from
 * the session the request carries rather than the bearer; the read is the
 * account's like every other. The client rides in the revoke's query, since
 * a `DELETE` carries no body.
 *
 * The outputs are the wire schemas flipped, so oRPC's output check encodes
 * the handler's value into the bytes the wire carries (`packages/service/src/orpc/base.ts`).
 */

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
