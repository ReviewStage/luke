import { lukeMcpApp } from "@luke/service/agents/luke-mcp/app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Luke's MCP server (POST), where a native harness's runner calls the tools that touch Luke, admitted by the runner's own bearer rather than an account's. The logic lives in `packages/service/src/agents/luke-mcp/app.ts`. */
export default routeFromHttpRouter(lukeMcpApp());
