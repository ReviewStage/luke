import { AGENT_ROLE } from "../../../../server/hosted/agent-runtime/role.js";
import { integrationConnectionsFor } from "../../../host.js";

/** The account's integrations its agent has switched on, for the worker, under its ownership check alone, since eve hands it none of the agent's connections (`server/hosted/agent-runtime/connections.ts`). */
export default integrationConnectionsFor(AGENT_ROLE.CODER_WORKER);
