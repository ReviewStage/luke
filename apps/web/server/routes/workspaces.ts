import { memberSeams, workspaceSeams } from "@luke/database/models/workspace-seams";
import { auth } from "../auth.js";
import { resolveHostedUserId } from "../hosted/bearer.js";
import { resolveBrowserSessionUserId } from "../hosted/browser-session.js";
import { routeFromHttpRouter } from "../route-effect.js";
import { workspacesApp } from "../workspaces-app.js";

/** The workspaces the account is a member of (GET), its first one made by the first read through this deployment's auth service. */
export default routeFromHttpRouter(
  workspacesApp({
    resolveUserId: resolveHostedUserId,
    resolveSessionUserId: resolveBrowserSessionUserId,
    workspaces: workspaceSeams(auth.api),
    members: memberSeams(auth.api),
  }),
);
