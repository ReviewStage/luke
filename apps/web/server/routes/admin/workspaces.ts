import { orpcRoute } from "../../orpc-route.js";

/**
 * The Workspaces tab's read (GET): shared workspaces' headline counts and the
 * table of workspaces, behind the same gate, scope, and search vocabulary as
 * the roster's read. Answered by the hosted oRPC router behind the admin gate
 * (`packages/service/src/admin/admin-procedures.ts`).
 */
export default orpcRoute;
