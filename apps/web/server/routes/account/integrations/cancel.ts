import { integrationsAppSeams } from "@luke/service/integrations/integration-seams";
import { integrationsApp } from "@luke/service/integrations/integrations-app";
import { routeFromHttpRouter } from "../../../route-effect.js";

/**
 * Ends the account's sign-in to one provider under way. The logic lives in
 * `packages/service/src/integrations/integrations-app.ts`; this file only hands it the deployment's real seams.
 */
export default routeFromHttpRouter(integrationsApp(integrationsAppSeams()));
