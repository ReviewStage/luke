import { auth } from "../../auth.js";
import { resolveHostedUserId } from "../../hosted/bearer.js";
import { workspaceSeams } from "../../hosted/workspace-seams.js";
import { routeFromHttpRouter } from "../../route-effect.js";
import { workspacesApp } from "../../workspaces-app.js";

/** One workspace's members, to a member of it (GET). */
export default routeFromHttpRouter(
  workspacesApp({ resolveUserId: resolveHostedUserId, workspaces: workspaceSeams(auth.api) }),
);
