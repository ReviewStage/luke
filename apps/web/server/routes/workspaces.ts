import { workspaceSeams } from "@sidecar/database/models/workspace-seams";
import { auth } from "../auth.js";
import { resolveHostedUserId } from "../hosted/bearer.js";
import { routeFromHttpRouter } from "../route-effect.js";
import { workspacesApp } from "../workspaces-app.js";

/** The workspaces the account is a member of (GET), its personal one made by the first read through this deployment's auth service. */
export default routeFromHttpRouter(
  workspacesApp({ resolveUserId: resolveHostedUserId, workspaces: workspaceSeams(auth.api) }),
);
