import { readAdminUserSource } from "../../server/admin/admin-queries.js";
import { buildAdminUserDetail, handleAdminUser } from "../../server/admin/admin-user.js";
import { withAdminViewer } from "../../server/admin/viewer.js";
import { getDatabase } from "../../server/db/index.js";

/**
 * One account's own page behind the overview's table. The gate and the day
 * arithmetic live behind seams in `server/admin/`; this file hands them the
 * deployment's real database. The id arrives from the page's own roster of
 * accounts and lands in one equality against the user table's key — it is
 * never rendered back and never reaches a write.
 */
export default withAdminViewer(["GET"], (_viewer, request) =>
  handleAdminUser({
    request,
    readUser: async (userId, now, windowDays) => {
      const source = await readAdminUserSource(getDatabase(), { userId, now, windowDays });
      return source && buildAdminUserDetail(source, now, windowDays);
    },
  }),
);
