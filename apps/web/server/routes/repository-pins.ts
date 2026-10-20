import { orpcRoute } from "../orpc-route.js";

/**
 * The repositories the account pinned in the sidebar: read them (GET), or pin or unpin one (PUT), answered by the hosted oRPC router
 * (`packages/service/src/github/repository-pins-procedures.ts`).
 */
export default orpcRoute;
