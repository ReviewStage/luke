import { AGENT_ROLE } from "@luke/service/agents/agent-runtime/role";
import { integrationConnectionsFor } from "../host.js";

/** The account's integrations, for the planning model, under the root's own ownership check (`packages/service/src/agents/agent-runtime/connections.ts`). */
export default integrationConnectionsFor(AGENT_ROLE.PLANNER);
