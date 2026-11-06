import { agentBrowserServices } from "@repo/service/agents/browser/agent-browser";
import { workspaceMcpApp } from "@repo/service/agents/workspace-mcp/app";
import { Layer } from "effect";
import { agentImage, nativeAgents } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";
import { webAgentSandboxDoor } from "../../runtime.js";

/** Our MCP server (POST), where a native harness's runner calls the tools that touch the service, admitted by the runner's own bearer rather than an account's. It runs in a function of its own, long enough for a `run_on_mac` (`function-durations.ts`). Its `browser` reaches the Chromium in the agent's sandbox (`agentBrowserServices`). The logic lives in `packages/service/src/agents/workspace-mcp/app.ts`. */
export default routeFromHttpRouter(
  workspaceMcpApp({
    sandbox: webAgentSandboxDoor,
    browser: agentBrowserServices.pipe(Layer.provide(agentImage)),
  }),
  nativeAgents,
);
