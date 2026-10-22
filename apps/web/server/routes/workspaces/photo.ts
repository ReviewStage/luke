import { workspacesApp } from "@luke/service/accounts/workspaces-app";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One workspace's photo, served as its bytes to a member of it (GET). The logic lives in `packages/service/src/accounts/workspaces-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(workspacesApp({ resolveUserId: resolveHostedUserId }));
