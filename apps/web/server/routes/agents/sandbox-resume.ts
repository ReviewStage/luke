import { agentTerminalsApp } from "../../agent-terminals-app.js";
import { resolveHostedUserId } from "../../hosted/bearer.js";
import { agentSandboxLayer } from "../../hosted/terminal/agent-sandbox.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Resumes a coding agent's stopped sandbox (POST), on the developer's click. The logic lives in `server/agent-terminals-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  agentTerminalsApp({ resolveUserId: resolveHostedUserId, sandbox: agentSandboxLayer }),
);
