import { maintenanceApp } from "@luke/service/maintenance/maintenance-app";
import { withNativeAgents } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The scheduled sweep's one entry, called by Vercel's cron on the cadence
 * `vercel.json` fixes. The logic lives in `packages/service/src/maintenance/maintenance-sweep.ts`,
 * behind the group in `packages/service/src/maintenance/maintenance-app.ts`; this file only hands the
 * group's export to the route adaptor.
 */
export default routeFromHttpRouter(maintenanceApp(), withNativeAgents);
