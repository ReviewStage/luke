import { workspaceSeams } from "@luke/database/models/workspace-seams";
import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { auth } from "@luke/service/auth/auth";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { tasksApp } from "@luke/service/tasks/tasks-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Every code Luke showed on one task (GET). The logic lives in `packages/service/src/plans/plans-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  tasksApp({
    resolveUserId: resolveHostedUserId,
    workspaces: workspaceSeams(auth.api),
    eveOrigin: deploymentEveOrigin,
  }),
);
