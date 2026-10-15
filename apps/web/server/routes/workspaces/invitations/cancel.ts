import { memberSeams, workspaceSeams } from "@luke/database/models/workspace-seams";
import { auth } from "@luke/service/auth/auth";
import { resolveHostedUserId } from "../../../hosted/bearer.js";
import { resolveBrowserSessionUserId } from "../../../hosted/browser-session.js";
import { routeFromHttpRouter } from "../../../route-effect.js";
import { workspacesApp } from "../../../workspaces-app.js";

/** A pending invitation canceled (POST) by an owner or an admin under the Mac's session. */
export default routeFromHttpRouter(
  workspacesApp({
    resolveUserId: resolveHostedUserId,
    resolveSessionUserId: resolveBrowserSessionUserId,
    workspaces: workspaceSeams(auth.api),
    members: memberSeams(auth.api),
  }),
);
