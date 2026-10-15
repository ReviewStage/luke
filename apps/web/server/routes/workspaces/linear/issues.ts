import { workspaceLinearAppSeams } from "@luke/service/integrations/integration-seams";
import { workspaceLinearApp } from "@luke/service/integrations/workspace-linear-app";
import { routeFromHttpRouter } from "../../../route-effect.js";

/**
 * The Linear issues a member of a workspace may start a plan from (POST). The logic lives in
 * `packages/service/src/integrations/workspace-linear-app.ts`; this file only hands it the deployment's real seams.
 */
export default routeFromHttpRouter(workspaceLinearApp(workspaceLinearAppSeams()));
