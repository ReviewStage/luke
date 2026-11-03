import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { auth } from "@repo/service/auth/auth";
import { authDeployment } from "@repo/service/auth/auth-deployment";
import { memberMcpApp, memberMcpAuth } from "@repo/service/member-mcp/app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** The member MCP server's protected resource metadata (GET), which the web service rewrites `/.well-known/oauth-protected-resource/api/mcp` and the well-known root onto (`function-rewrites.ts`): the same group as `mcp.ts`, answering the metadata's own route. */
export default routeFromHttpRouter(
  memberMcpApp(
    memberMcpAuth(
      oauthProviderResourceClient(auth).getActions(),
      authDeployment(process.env).baseURL,
    ),
  ),
);
