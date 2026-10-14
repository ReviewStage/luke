import { memberSeams, workspaceSeams } from "@sidecar/database/models/workspace-seams";
import { auth } from "../../../auth.js";
import { resolveHostedUserId } from "../../../hosted/bearer.js";
import { resolveBrowserSessionUserId } from "../../../hosted/browser-session.js";
import { routeFromHttpRouter } from "../../../route-effect.js";
import { workspacesApp } from "../../../workspaces-app.js";

/** A workspace's GitHub organization connected: where the browser goes to install the Luke GitHub App for it (POST), by an owner or admin of it. */
export default routeFromHttpRouter(
  workspacesApp({
    resolveUserId: resolveHostedUserId,
    resolveSessionUserId: resolveBrowserSessionUserId,
    workspaces: workspaceSeams(auth.api),
    members: memberSeams(auth.api),
  }),
);
