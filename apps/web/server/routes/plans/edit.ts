import { auth } from "../../auth.js";
import { resolveHostedUserId } from "../../hosted/bearer.js";
import { workspaceSeams } from "../../hosted/workspace-seams.js";
import { plansApp } from "../../plans-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** The developer's edit of one field of a plan the caller owns, by the id its path carries (POST). */
export default routeFromHttpRouter(
  plansApp({ resolveUserId: resolveHostedUserId, workspaces: workspaceSeams(auth.api) }),
);
