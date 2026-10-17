import { workspaceSeams } from "@luke/database/models/workspace-seams";
import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { auth } from "@luke/service/auth/auth";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { tasksApp } from "@luke/service/tasks/tasks-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One folder of a task's repository as GitHub holds it now, for the File tab's tree, by the id its path carries (GET). */
export default routeFromHttpRouter(
  tasksApp({
    resolveUserId: resolveHostedUserId,
    workspaces: workspaceSeams(auth.api),
    eveOrigin: deploymentEveOrigin,
  }),
);
