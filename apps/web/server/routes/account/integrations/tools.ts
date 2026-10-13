import { integrationsAppSeams } from "../../../hosted/integration-seams.js";
import { integrationsApp } from "../../../integrations-app.js";
import { routeFromHttpRouter } from "../../../route-effect.js";

/**
 * Reads the tools one provider's server offers the account's agents. The logic lives in
 * `server/integrations-app.ts`; this file only hands it the deployment's real seams.
 */
export default routeFromHttpRouter(integrationsApp(integrationsAppSeams()));
