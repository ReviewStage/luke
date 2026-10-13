import { workspaceSeams } from "@sidecar/database/models/workspace-seams";
import { auth } from "../../../auth.js";
import { resolveHostedUserId } from "../../../hosted/bearer.js";
import { routeFromHttpRouter } from "../../../route-effect.js";
import { workspacesApp } from "../../../workspaces-app.js";

/** A workspace's GitHub organization disconnected (POST), by an owner or admin of it. */
export default routeFromHttpRouter(
  workspacesApp({ resolveUserId: resolveHostedUserId, workspaces: workspaceSeams(auth.api) }),
);
