import { buildAdminDayDetail, handleAdminDay } from "../../admin/admin-day.js";
import { readAdminDaySource } from "../../admin/admin-queries.js";
import { withAdminViewer } from "../../admin/viewer.js";
import { getDatabase } from "../../db/index.js";

/**
 * One day of the overview's usage chart, opened into its accounts. The gate
 * and the day validation live behind seams in `server/admin/`; this file
 * hands them the deployment's real database. The day arrives validated as a
 * real UTC calendar key and lands in one equality against the usage table's
 * day column — it is never rendered back and never reaches a write.
 */
export default withAdminViewer(["GET"], (_viewer, request) =>
  handleAdminDay({
    request,
    readDay: async (day, now, scope) =>
      buildAdminDayDetail(await readAdminDaySource(getDatabase(), { day, scope }), now, day),
  }),
);
