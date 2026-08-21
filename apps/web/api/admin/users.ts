import { readAdminUsersSource } from "../../server/admin/admin-queries.js";
import { buildAdminUserList, handleAdminUsers } from "../../server/admin/admin-users.js";
import { resolveSessionViewer } from "../../server/admin/viewer.js";
import { getDatabase } from "../../server/db/index.js";

/**
 * The Users tab's read: the whole account roster with window aggregates,
 * behind the same gate and scope vocabulary as the metrics read. The logic
 * lives behind seams in `server/admin/`; this file hands it the deployment's
 * real session resolver and database.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return handleAdminUsers({
      request,
      resolveViewer: resolveSessionViewer,
      readUsers: async (now, scope) =>
        buildAdminUserList(await readAdminUsersSource(getDatabase(), { now, scope }), now),
    });
  },
};
