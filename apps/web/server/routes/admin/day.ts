import { orpcRoute } from "../../orpc-route.js";

/**
 * One day of the overview's usage chart, opened into its accounts (GET). The
 * day arrives validated as a real UTC calendar key and lands in one equality
 * against the usage table's day column; it is never rendered back and never
 * reaches a write. Answered by the hosted oRPC router behind the admin gate
 * (`packages/service/src/admin/admin-procedures.ts`).
 */
export default orpcRoute;
