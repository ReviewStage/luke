import { workspaceSeams } from "@luke/database/models/workspace-seams";
import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { auth } from "@luke/service/auth/auth";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { tasksApp } from "@luke/service/tasks/tasks-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** A page of a plan's history, newest first, by the id its path carries (GET). */
export default routeFromHttpRouter(
  tasksApp({
    resolveUserId: resolveHostedUserId,
    workspaces: workspaceSeams(auth.api),
    eveOrigin: deploymentEveOrigin,
  }),
);
