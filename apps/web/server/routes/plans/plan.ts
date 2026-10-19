import { orpcRoute } from "../../orpc-route.js";

/**
 * One plan the caller reaches: open it (GET), change it (PATCH), or delete it (DELETE), answered by
 * the hosted oRPC router (`packages/service/src/tasks/tasks-procedures.ts`).
 */
export default orpcRoute;
