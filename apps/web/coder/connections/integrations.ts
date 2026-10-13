import { AGENT_ROLE } from "../../server/hosted/agent-runtime/role.js";
import { integrationConnectionsFor } from "../host.js";

/** The account's integrations the agent has switched on, under the agent's own ownership check (`server/hosted/agent-runtime/connections.ts`). */
export default integrationConnectionsFor(AGENT_ROLE.CODER);
