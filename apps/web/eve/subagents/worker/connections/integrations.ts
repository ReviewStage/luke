import { AGENT_ROLE } from "@luke/service/agents/agent-runtime/role";
import { integrationConnectionsFor } from "../../../host.js";

/** The account's integrations, for the worker, under its ownership check alone, since eve hands it none of the root's connections (`server/hosted/agent-runtime/connections.ts`). */
export default integrationConnectionsFor(AGENT_ROLE.PLANNER_WORKER);
