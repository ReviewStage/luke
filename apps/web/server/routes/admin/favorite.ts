import { adminApp } from "@luke/service/admin/admin-app";
import { hostedAdminSeams } from "@luke/service/admin/admin-route";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The Users tab's star write: PUT favorites the named account for the
 * signed-in admin, DELETE takes the star back. It lives behind the group in
 * `@luke/service/admin/admin-app`; this file only hands it the deployment's real seams.
 */
export default routeFromHttpRouter(adminApp(hostedAdminSeams()));
