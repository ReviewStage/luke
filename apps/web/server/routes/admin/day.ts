import { hostedAdminSeams } from "../../admin/admin-route.js";
import { adminApp } from "../../admin-app.js";
import { routeFromHttpApp } from "../../route-effect.js";

/**
 * One day of the overview's usage chart, opened into its accounts. It lives
 * behind the group in `server/admin-app.ts`; this file only hands it the
 * deployment's real seams. The day arrives validated as a real UTC calendar
 * key and lands in one equality against the usage table's day column — it is
 * never rendered back and never reaches a write.
 */
export default routeFromHttpApp(adminApp(hostedAdminSeams()));
