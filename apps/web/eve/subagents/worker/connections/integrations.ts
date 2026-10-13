import { AGENT_ROLE } from "../../../../server/hosted/agent-runtime/role.js";
import { integrationConnectionsFor } from "../../../host.js";

/** The account's integrations, for the worker, under its ownership check alone, since eve hands it none of the root's connections (`server/hosted/agent-runtime/connections.ts`). */
export default integrationConnectionsFor(AGENT_ROLE.PLANNER_WORKER);
