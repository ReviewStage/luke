import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { agentTerminalsApp } from "../../agent-terminals-app.js";
import { agentSandboxLayer } from "../../hosted/terminal/agent-sandbox.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Names one of a coding agent's shells anew (PATCH) or ends it (DELETE). The logic lives in `server/agent-terminals-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  agentTerminalsApp({ resolveUserId: resolveHostedUserId, sandbox: agentSandboxLayer }),
);
