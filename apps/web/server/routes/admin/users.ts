import { adminApp } from "@luke/service/admin/admin-app";
import { hostedAdminSeams } from "@luke/service/admin/admin-route";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The Users tab's read: the whole account roster with window aggregates,
 * behind the same gate and scope vocabulary as the metrics read. It lives
 * behind the group in `@luke/service/admin/admin-app`; this file only hands it the
 * deployment's real seams.
 */
export default routeFromHttpRouter(adminApp(hostedAdminSeams()));
