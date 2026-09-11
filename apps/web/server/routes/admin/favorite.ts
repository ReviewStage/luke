import { hostedAdminSeams } from "../../admin/admin-route.js";
import { adminApp } from "../../admin-app.js";
import { routeFromHttpApp } from "../../route-effect.js";

/**
 * The Users tab's star write: PUT favorites the named account for the
 * signed-in admin, DELETE takes the star back. It lives behind the group in
 * `server/admin-app.ts`; this file only hands it the deployment's real seams.
 */
export default routeFromHttpApp(adminApp(hostedAdminSeams()));
