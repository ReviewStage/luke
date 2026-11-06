import { integrationsAppSeams } from "@repo/service/integrations/integration-seams";
import { integrationsApp } from "@repo/service/integrations/integrations-app";
import { routeFromHttpRouter } from "../../../route-effect.js";

export default routeFromHttpRouter(integrationsApp(integrationsAppSeams()));
