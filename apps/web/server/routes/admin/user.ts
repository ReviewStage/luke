import { hostedAdminSeams } from "../../admin/admin-route.js";
import { adminApp } from "../../admin-app.js";
import { routeFromHttpApp } from "../../route-effect.js";

/**
 * One account's own page behind the overview's table. It lives behind the
 * group in `server/admin-app.ts`; this file only hands it the deployment's
 * real seams. The id arrives from the page's own roster of accounts and lands
 * in one equality against the user table's key — it is never rendered back
 * and never reaches a write.
 */
export default routeFromHttpApp(adminApp(hostedAdminSeams()));
