import { workspaceLinearAppSeams } from "@luke/service/integrations/integration-seams";
import { workspaceLinearApp } from "@luke/service/integrations/workspace-linear-app";
import { routeFromHttpRouter } from "../../../route-effect.js";

/**
 * Begins a workspace's Linear sign-in, by an owner or admin of it (POST). The logic lives in
 * `packages/service/src/integrations/workspace-linear-app.ts`; this file only hands it the deployment's real seams.
 */
export default routeFromHttpRouter(workspaceLinearApp(workspaceLinearAppSeams()));
