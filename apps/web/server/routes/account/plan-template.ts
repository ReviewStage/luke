import { accountApp } from "../../account-app.js";
import { accountAppSeams } from "../../hosted/account-seams.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * Every account endpoint, over this deployment's real database, environment,
 * and auth session. The logic lives in `server/account-app.ts`; this file
 * only hands it the deployment's real seams.
 */
export default routeFromHttpRouter(accountApp(accountAppSeams()));
