import { lukeMcpApp } from "@luke/service/agents/luke-mcp/app";
import { nativeAgents } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";
import { webAgentSandboxDoor } from "../../runtime.js";

/** Luke's MCP server (POST), where a native harness's runner calls the tools that touch Luke, admitted by the runner's own bearer rather than an account's. It runs in a function of its own, long enough for a `run_on_mac` (`function-durations.ts`). The logic lives in `packages/service/src/agents/luke-mcp/app.ts`. */
export default routeFromHttpRouter(lukeMcpApp(webAgentSandboxDoor), nativeAgents);
