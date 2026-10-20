import { orpcRoute } from "../../orpc-route.js";

/**
 * The Cost screen's read (GET): what the hosted service spent over the window,
 * priced at read time from the usage its own tables keep. Answered by the
 * hosted oRPC router behind the admin gate
 * (`packages/service/src/admin/admin-procedures.ts`).
 */
export default orpcRoute;
