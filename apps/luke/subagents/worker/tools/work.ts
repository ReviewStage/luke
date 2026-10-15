import { WORKER_TOOL_NAMES } from "@luke/service/agents/brain-host/planning";
import { host } from "../../../host.js";
import { hostedTools } from "../../../tools/brain.js";

/** The worker's tools: the planning model's own reads, admitted on ownership as a subagent's resolvers are. */
export default hostedTools(WORKER_TOOL_NAMES, host.admitDelegated);
