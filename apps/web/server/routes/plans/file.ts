import { workspaceSeams } from "@luke/database/models/workspace-seams";
import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { auth } from "@luke/service/auth/auth";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { plansApp } from "@luke/service/plans/plans-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** A window of one file of a plan's repository as GitHub holds it now, for the File tab, by the id its path carries (GET). */
export default routeFromHttpRouter(
  plansApp({
    resolveUserId: resolveHostedUserId,
    workspaces: workspaceSeams(auth.api),
    eveOrigin: deploymentEveOrigin,
  }),
);
