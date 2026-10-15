import { AGENT_ROLE } from "@luke/service/agents/agent-runtime/role";
import { integrationConnectionsFor } from "../../../host.js";

/** The account's integrations its agent has switched on, for the worker, under its ownership check alone, since eve hands it none of the agent's connections (`packages/service/src/agents/agent-runtime/connections.ts`). */
export default integrationConnectionsFor(AGENT_ROLE.CODER_WORKER);
