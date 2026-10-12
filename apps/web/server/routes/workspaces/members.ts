import { auth } from "../../auth.js";
import { workspaceMemberSeams } from "../../hosted/workspace-seams.js";
import { routeFromHttpRouter } from "../../route-effect.js";
import { workspacesMembersApp } from "../../workspaces-members-app.js";

/** The Workspaces page adds an existing Luke account to a workspace by email (POST), on the browser's session. */
export default routeFromHttpRouter(workspacesMembersApp(workspaceMemberSeams(auth.api)));
