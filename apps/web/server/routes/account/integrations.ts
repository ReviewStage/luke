import { integrationsAppSeams } from "../../hosted/integration-seams.js";
import { integrationsApp } from "../../integrations-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * Where every one of the account's integrations stands. The logic lives in
 * `server/integrations-app.ts`; this file only hands it the deployment's real seams.
 */
export default routeFromHttpRouter(integrationsApp(integrationsAppSeams()));
