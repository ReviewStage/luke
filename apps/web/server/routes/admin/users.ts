import { readAdminUsersSource } from "../../admin/admin-queries.js";
import { buildAdminUserList, handleAdminUsers } from "../../admin/admin-users.js";
import { withAdminViewer } from "../../admin/viewer.js";
import { getDatabase } from "../../db/index.js";

/**
 * The Users tab's read: the whole account roster with window aggregates,
 * behind the same gate and scope vocabulary as the metrics read. The logic
 * lives behind seams in `server/admin/`; this file hands it the deployment's
 * real database.
 */
export default withAdminViewer(["GET"], (viewer, request) =>
  handleAdminUsers({
    request,
    viewer,
    readUsers: async (now, scope, viewerId, windowDays, search) =>
      buildAdminUserList(
        await readAdminUsersSource(getDatabase(), { now, scope, search, viewerId, windowDays }),
        now,
        windowDays,
        search,
      ),
  }),
);
