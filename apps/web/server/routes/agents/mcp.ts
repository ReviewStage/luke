import { agentBrowserServices } from "@repo/service/agents/browser/agent-browser";
import { workspaceMcpApp } from "@repo/service/agents/workspace-mcp/app";
import { nativeAgents } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";
import { webAgentSandboxDoor } from "../../runtime.js";

export default routeFromHttpRouter(
  workspaceMcpApp({ sandbox: webAgentSandboxDoor, browser: agentBrowserServices }),
  nativeAgents,
);
