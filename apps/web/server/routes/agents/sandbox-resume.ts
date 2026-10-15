import { agentSandboxLayer } from "@luke/service/agents/terminal/agent-sandbox";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { agentTerminalsApp } from "../../agent-terminals-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Resumes a coding agent's stopped sandbox (POST), on the developer's click. The logic lives in `server/agent-terminals-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  agentTerminalsApp({ resolveUserId: resolveHostedUserId, sandbox: agentSandboxLayer }),
);
