import { automationSchedulesBackfillApp } from "@repo/service/automations/automation-schedules-backfill";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The one-off keeping of every scheduled automation's Vercel schedule, asked
 * by hand under the deployment's `CRON_SECRET`
 * (`scripts/backfill-automation-schedules.sh`). The logic lives in
 * `packages/service/src/automations/automation-schedules-backfill.ts`; this
 * file only hands the group's export to the route adaptor.
 */
export default routeFromHttpRouter(automationSchedulesBackfillApp());
