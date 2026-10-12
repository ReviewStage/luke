import { auth } from "../../auth.js";
import { resolveHostedUserId } from "../../hosted/bearer.js";
import { workspaceSeams } from "../../hosted/workspace-seams.js";
import { plansApp } from "../../plans-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** A window of one file of a plan's repository as GitHub holds it now, for the File tab, by the id its path carries (GET). */
export default routeFromHttpRouter(
  plansApp({ resolveUserId: resolveHostedUserId, workspaces: workspaceSeams(auth.api) }),
);
