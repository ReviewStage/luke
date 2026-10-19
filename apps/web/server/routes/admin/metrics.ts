import { orpcRoute } from "../../orpc-route.js";

/**
 * The admin dashboard's read (GET). The role is read from the session by the
 * gate, never asserted by the request, and no secret value crosses into the
 * answer: only whether each key is present. Answered by the hosted oRPC router
 * behind the admin gate (`packages/service/src/admin/admin-procedures.ts`).
 */
export default orpcRoute;
