import { runSnapshotApp } from "@luke/service/agents/run-snapshot-app";
import { agentSandboxLayer } from "@luke/service/agents/terminal/agent-sandbox";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { routeFromHttpRouter } from "../../route-effect.js";

/** A coding agent's working tree, taken for the Mac that runs it (POST). The logic lives in `packages/service/src/agents/run-snapshot-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  runSnapshotApp({ resolveUserId: resolveHostedUserId, sandbox: agentSandboxLayer }),
);
