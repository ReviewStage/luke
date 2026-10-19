import { integrationsAppSeams } from "@luke/service/integrations/integration-seams";
import { integrationsApp } from "@luke/service/integrations/integrations-app";
import { routeFromHttpRouter } from "../../../route-effect.js";

/**
 * Settles the account's integration sign-ins under way, then answers where each stands. The logic lives in
 * `packages/service/src/integrations/integrations-app.ts`; this file only hands it the deployment's real seams.
 */
export default routeFromHttpRouter(integrationsApp(integrationsAppSeams()));
