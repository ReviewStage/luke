import { orpcRoute } from "../../orpc-route.js";

/**
 * One account's own page behind the overview's table (GET). The id arrives
 * from the page's own roster of accounts and lands in one equality against the
 * user table's key; it is never rendered back and never reaches a write.
 * Answered by the hosted oRPC router behind the admin gate
 * (`packages/service/src/admin/admin-procedures.ts`).
 */
export default orpcRoute;
