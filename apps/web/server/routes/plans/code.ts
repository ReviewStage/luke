import { workspaceSeams } from "@luke/database/models/workspace-seams";
import { auth } from "@luke/service/auth/auth";
import { resolveHostedUserId } from "../../hosted/bearer.js";
import { deploymentEveOrigin } from "../../hosted/brain-host/eve-origin.js";
import { plansApp } from "../../plans-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Every code Luke showed on one plan (GET). The logic lives in `server/plans-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  plansApp({
    resolveUserId: resolveHostedUserId,
    workspaces: workspaceSeams(auth.api),
    eveOrigin: deploymentEveOrigin,
  }),
);
