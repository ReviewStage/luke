import { orpcRoute } from "../../orpc-route.js";

/**
 * An owner or admin renames a workspace (POST), its slug left as it was, answered by the hosted oRPC router
 * (`packages/service/src/accounts/workspaces-procedures.ts`).
 */
export default orpcRoute;
