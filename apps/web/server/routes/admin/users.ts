import { hostedAdminSeams } from "../../admin/admin-route.js";
import { adminApp } from "../../admin-app.js";
import { routeFromHttpApp } from "../../route-effect.js";

/**
 * The Users tab's read: the whole account roster with window aggregates,
 * behind the same gate and scope vocabulary as the metrics read. It lives
 * behind the group in `server/admin-app.ts`; this file only hands it the
 * deployment's real seams.
 */
export default routeFromHttpApp(adminApp(hostedAdminSeams()));
