import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { issuesApp } from "@luke/service/issues/issues-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One issue: read it (GET), or change it (PATCH). The logic lives in `packages/service/src/issues/issues-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(issuesApp({ resolveUserId: resolveHostedUserId }));
