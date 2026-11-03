import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { auth } from "@repo/service/auth/auth";
import { authDeployment } from "@repo/service/auth/auth-deployment";
import { memberMcpApp, memberMcpAuth } from "@repo/service/member-mcp/app";
import { nativeAgents } from "../native-agents.js";
import { routeFromHttpRouter } from "../route-effect.js";

/** The member MCP server (POST), where an outside MCP client acts for a member on an access token the auth service minted for the server, verified by Better Auth's resource client over the deployment's own auth service, every address the deployment's base URL's. An answer, a message, or a close it writes on a thread reaches the thread's agent through its harness (`nativeAgents`), as the window's does. The logic lives in `packages/service/src/member-mcp/app.ts`. */
export default routeFromHttpRouter(
  memberMcpApp(
    memberMcpAuth(
      oauthProviderResourceClient(auth).getActions(),
      authDeployment(process.env).baseURL,
    ),
  ),
  nativeAgents,
);
