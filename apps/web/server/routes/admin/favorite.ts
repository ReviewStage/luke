import { orpcRoute } from "../../orpc-route.js";

/**
 * The Users tab's star write: PUT favorites the named account for the signed-
 * in admin, DELETE takes the star back. Answered by the hosted oRPC router
 * behind the admin gate (`packages/service/src/admin/admin-procedures.ts`).
 */
export default orpcRoute;
