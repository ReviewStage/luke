import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { issuesApp } from "@luke/service/issues/issues-app";
import { routeFromHttpRouter } from "../route-effect.js";

/** A workspace's issues: list them (GET), or file one (POST). The logic lives in `packages/service/src/issues/issues-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(issuesApp({ resolveUserId: resolveHostedUserId }));
