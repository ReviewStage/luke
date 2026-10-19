import { adminApp } from "@luke/service/admin/admin-app";
import { hostedAdminSeams } from "@luke/service/admin/admin-route";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The Cost screen's read: what the hosted service spent over the window,
 * priced at read time from the usage its own tables keep. It lives behind
 * the group in `@luke/service/admin/admin-app`; this file only hands it the
 * deployment's real seams.
 */
export default routeFromHttpRouter(adminApp(hostedAdminSeams()));
