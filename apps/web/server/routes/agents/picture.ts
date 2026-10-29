import { agentsApp } from "@luke/service/agents/agents-app";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One picture a tool answered an agent or one of its workers, served as its bytes to whoever may read the agent (GET). The logic lives in `packages/service/src/agents/agents-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(agentsApp({ resolveUserId: resolveHostedUserId }));
