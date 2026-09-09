import { handleAdminFavorite } from "../../server/admin/admin-favorite.js";
import { writeAdminFavorite } from "../../server/admin/admin-queries.js";
import { withAdminViewer } from "../../server/admin/viewer.js";
import { getDatabase } from "../../server/db/index.js";

/**
 * The Users tab's star write: PUT favorites the named account for the signed-in
 * admin, DELETE takes the star back. The logic lives behind seams in
 * `server/admin/`; this file hands it the deployment's real database.
 */
export default withAdminViewer(["PUT", "DELETE"], (viewer, request) =>
  handleAdminFavorite({
    request,
    viewer,
    writeFavorite: (adminId, userId, favorite) =>
      writeAdminFavorite(getDatabase(), { adminId, userId, favorite }),
  }),
);
