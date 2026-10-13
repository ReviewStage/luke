import { workspaceSeams } from "@sidecar/database/models/workspace-seams";
import { auth } from "../../auth.js";
import { resolveHostedUserId } from "../../hosted/bearer.js";
import { deploymentEveOrigin } from "../../hosted/brain-host/eve-origin.js";
import { plansApp } from "../../plans-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One folder of a plan's repository as GitHub holds it now, for the File tab's tree, by the id its path carries (GET). */
export default routeFromHttpRouter(
  plansApp({
    resolveUserId: resolveHostedUserId,
    workspaces: workspaceSeams(auth.api),
    eveOrigin: deploymentEveOrigin,
  }),
);
