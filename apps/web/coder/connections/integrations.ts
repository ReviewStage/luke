import { AGENT_ROLE } from "@luke/service/agents/agent-runtime/role";
import { integrationConnectionsFor } from "../host.js";

/** The account's integrations the agent has switched on, under the agent's own ownership check (`packages/service/src/agents/agent-runtime/connections.ts`). */
export default integrationConnectionsFor(AGENT_ROLE.CODER);
