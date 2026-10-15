import { adminApp } from "@luke/service/admin/admin-app";
import { hostedAdminSeams } from "@luke/service/admin/admin-route";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The admin dashboard's read. The gate and the read live behind the group in
 * `@luke/service/admin/admin-app`; this file only hands it the deployment's real seams.
 * The role is read from the session by the gate, never asserted by the
 * request, and no secret value crosses into the answer: only whether each key
 * is present.
 */
export default routeFromHttpRouter(adminApp(hostedAdminSeams()));
