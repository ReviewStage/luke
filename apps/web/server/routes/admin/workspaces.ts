import { adminApp } from "@luke/service/admin/admin-app";
import { hostedAdminSeams } from "@luke/service/admin/admin-route";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The Workspaces tab's read: shared workspaces' headline counts and the
 * table of workspaces, behind the same gate, scope, and search vocabulary as
 * the roster's read. It lives behind the group in
 * `@luke/service/admin/admin-app`; this file only hands it the deployment's
 * real seams.
 */
export default routeFromHttpRouter(adminApp(hostedAdminSeams()));
