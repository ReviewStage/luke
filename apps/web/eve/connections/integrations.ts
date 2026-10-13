import { AGENT_ROLE } from "../../server/hosted/agent-runtime/role.js";
import { integrationConnectionsFor } from "../host.js";

/** The account's integrations, for the planning model, under the root's own ownership check (`server/hosted/agent-runtime/connections.ts`). */
export default integrationConnectionsFor(AGENT_ROLE.PLANNER);
