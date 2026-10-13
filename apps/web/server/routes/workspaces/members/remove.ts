import { workspaceSeams } from "@sidecar/database/models/workspace-seams";
import { auth } from "../../../auth.js";
import { resolveHostedUserId } from "../../../hosted/bearer.js";
import { routeFromHttpRouter } from "../../../route-effect.js";
import { workspacesApp } from "../../../workspaces-app.js";

/** An owner or an admin removes a member who is not an owner (POST). */
export default routeFromHttpRouter(
  workspacesApp({ resolveUserId: resolveHostedUserId, workspaces: workspaceSeams(auth.api) }),
);
