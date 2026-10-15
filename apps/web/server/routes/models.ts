import { modelsApp } from "@luke/service/accounts/models-app";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { routeFromHttpRouter } from "../route-effect.js";

/**
 * The models a coding agent may run on, over this deployment's auth session
 * and the catalog the runtime holds. The logic lives in
 * `packages/service/src/accounts/models-app.ts`; this file only hands it the deployment's real
 * bearer resolution.
 */
export default routeFromHttpRouter(modelsApp({ resolveUserId: resolveHostedUserId }));
