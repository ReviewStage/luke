import { accountApp } from "@luke/service/accounts/account-app";
import { accountAppSeams } from "@luke/service/accounts/account-seams";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * Every account endpoint, over this deployment's real database, environment,
 * and auth session. The logic lives in `packages/service/src/accounts/account-app.ts`; this file
 * only hands it the deployment's real seams.
 */
export default routeFromHttpRouter(accountApp(accountAppSeams()));
