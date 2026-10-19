import { orpcRoute } from "../../orpc-route.js";

/**
 * The admin Reliability screen's read (GET). Failures are answered as counts
 * and fixed words, and providers by whether their keys are present, never
 * their values. Answered by the hosted oRPC router behind the admin gate
 * (`packages/service/src/admin/admin-procedures.ts`).
 */
export default orpcRoute;
