import { auth } from "../../auth.js";
import { resolveHostedUserId } from "../../hosted/bearer.js";
import { workspaceSeams } from "../../hosted/workspace-seams.js";
import { routeFromHttpRouter } from "../../route-effect.js";
import { workspacesApp } from "../../workspaces-app.js";

/** The account leaves a workspace it does not own (POST). */
export default routeFromHttpRouter(
  workspacesApp({ resolveUserId: resolveHostedUserId, workspaces: workspaceSeams(auth.api) }),
);
