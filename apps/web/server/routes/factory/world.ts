import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { factoryWorldApp } from "@luke/service/factory/factory-world-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * A workspace's Factory world, read as it stands now by a member of it (POST). The logic lives in
 * `packages/service/src/factory/factory-world-app.ts`; this file only hands it the deployment's real seams.
 */
export default routeFromHttpRouter(factoryWorldApp({ resolveUserId: resolveHostedUserId }));
