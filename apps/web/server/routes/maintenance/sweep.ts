import { maintenanceApp } from "../../maintenance-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The scheduled sweep's one entry, called by Vercel's cron on the cadence
 * `vercel.json` fixes. The logic lives in `server/hosted/maintenance-sweep.ts`,
 * behind the group in `server/maintenance-app.ts`; this file only hands the
 * group's export to the route adaptor.
 */
export default routeFromHttpRouter(maintenanceApp());
