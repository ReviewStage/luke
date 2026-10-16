import { integrationsAppSeams } from "@luke/service/integrations/integration-seams";
import { integrationsApp } from "@luke/service/integrations/integrations-app";
import { routeFromHttpRouter } from "../../../route-effect.js";

/**
 * Names one of the account's accounts at a provider. The logic lives in
 * `packages/service/src/integrations/integrations-app.ts`; this file only hands it the deployment's real seams.
 */
export default routeFromHttpRouter(integrationsApp(integrationsAppSeams()));
