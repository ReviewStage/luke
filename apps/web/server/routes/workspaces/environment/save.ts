import { workspaceEnvironmentApp } from "@luke/service/accounts/workspace-environment-app";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { routeFromHttpRouter } from "../../../route-effect.js";

/** One environment variable or secret saved by an owner or admin of the workspace (POST). The logic lives in `packages/service/src/accounts/workspace-environment-app.ts`. */
export default routeFromHttpRouter(workspaceEnvironmentApp({ resolveUserId: resolveHostedUserId }));
