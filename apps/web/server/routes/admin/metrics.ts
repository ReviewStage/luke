import { hostedAdminSeams } from "../../admin/admin-route.js";
import { adminApp } from "../../admin-app.js";
import { routeFromHttpApp } from "../../route-effect.js";

/**
 * The admin dashboard's read. The gate and the read live behind the group in
 * `server/admin-app.ts`; this file only hands it the deployment's real seams.
 * The role is read from the session by the gate, never asserted by the
 * request, and no secret value crosses into the answer: only whether each key
 * is present.
 */
export default routeFromHttpApp(adminApp(hostedAdminSeams()));
