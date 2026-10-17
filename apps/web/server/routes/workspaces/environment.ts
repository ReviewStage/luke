import { workspaceEnvironmentApp } from "@luke/service/accounts/workspace-environment-app";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { routeFromHttpRouter } from "../../route-effect.js";

/** A workspace's environment variables and secrets, to a member of it (POST). The logic lives in `packages/service/src/accounts/workspace-environment-app.ts`. */
export default routeFromHttpRouter(workspaceEnvironmentApp({ resolveUserId: resolveHostedUserId }));
