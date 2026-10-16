import { workspaceSeams } from "@luke/database/models/workspace-seams";
import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { auth } from "@luke/service/auth/auth";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { tasksApp } from "@luke/service/tasks/tasks-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** What Luke worked on in one plan, a page at a time, and every code he showed on it, by the id its path carries (GET). */
export default routeFromHttpRouter(
  tasksApp({
    resolveUserId: resolveHostedUserId,
    workspaces: workspaceSeams(auth.api),
    eveOrigin: deploymentEveOrigin,
  }),
);
