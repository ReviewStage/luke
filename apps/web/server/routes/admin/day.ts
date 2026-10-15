import { adminApp } from "@luke/service/admin/admin-app";
import { hostedAdminSeams } from "@luke/service/admin/admin-route";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * One day of the overview's usage chart, opened into its accounts. It lives
 * behind the group in `@luke/service/admin/admin-app`; this file only hands it the
 * deployment's real seams. The day arrives validated as a real UTC calendar
 * key and lands in one equality against the usage table's day column — it is
 * never rendered back and never reaches a write.
 */
export default routeFromHttpRouter(adminApp(hostedAdminSeams()));
