import { observationApp } from "../../observation-app.js";
import { routeFromHttpApp } from "../../route-effect.js";

/**
 * The scheduled observation's one entry, called by Vercel's cron on the
 * cadence `vercel.json` fixes. The logic lives in
 * `server/hosted/observation-tick.ts`, behind the group in
 * `server/observation-app.ts`; this file only hands the group's export to the
 * route adaptor.
 */
export default routeFromHttpApp(observationApp());
