import { orpcRoute } from "../../orpc-route.js";

/**
 * The Users tab's read (GET): the whole account roster with window aggregates,
 * behind the same gate and scope vocabulary as the metrics read. Answered by
 * the hosted oRPC router behind the admin gate
 * (`packages/service/src/admin/admin-procedures.ts`).
 */
export default orpcRoute;
