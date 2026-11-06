import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { auth } from "@repo/service/auth/auth";
import { authDeployment } from "@repo/service/auth/auth-deployment";
import { memberMcpApp, memberMcpAuth } from "@repo/service/member-mcp/app";
import { routeFromHttpRouter } from "../../route-effect.js";

export default routeFromHttpRouter(
  memberMcpApp(
    memberMcpAuth(
      oauthProviderResourceClient(auth).getActions(),
      authDeployment(process.env).baseURL,
    ),
  ),
);
