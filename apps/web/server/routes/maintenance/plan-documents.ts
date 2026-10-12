import { planBackfillApp } from "../../plan-backfill-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The switch's carrying over of every plan still kept as the fixed
 * template's fields to one document, asked by hand under the deployment's
 * `CRON_SECRET` (`scripts/backfill-plan-documents.sh`). The logic lives in
 * `server/hosted/plan-backfill.ts`, behind the group in
 * `server/plan-backfill-app.ts`; this file only hands the group's export to
 * the route adaptor.
 */
export default routeFromHttpRouter(planBackfillApp());
