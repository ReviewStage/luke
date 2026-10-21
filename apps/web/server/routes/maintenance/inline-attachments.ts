import { lineFilesBackfillApp } from "@luke/service/maintenance/line-files-backfill-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The backfill of the files developers' lines carried inline, asked by hand
 * under the deployment's `CRON_SECRET` (`scripts/move-inline-attachments.sh`).
 * The logic lives in `packages/service/src/maintenance/line-files-backfill.ts`, behind the
 * group in `packages/service/src/maintenance/line-files-backfill-app.ts`; this file only
 * hands the group's export to the route adaptor.
 */
export default routeFromHttpRouter(lineFilesBackfillApp());
