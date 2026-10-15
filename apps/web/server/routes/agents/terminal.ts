import { agentTerminalsApp } from "@luke/service/agents/agent-terminals-app";
import { agentSandboxLayer } from "@luke/service/agents/terminal/agent-sandbox";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Names one of a coding agent's shells anew (PATCH) or ends it (DELETE). The logic lives in `packages/service/src/agents/agent-terminals-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  agentTerminalsApp({ resolveUserId: resolveHostedUserId, sandbox: agentSandboxLayer }),
);
