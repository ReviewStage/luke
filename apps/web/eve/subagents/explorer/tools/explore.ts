import { EXPLORER_TOOL_NAMES } from "../../../../server/hosted/brain-host/planning.js";
import { host } from "../../../host.js";
import { hostedTools } from "../../../tools/brain.js";

/** The explorer's tools: the planning model's own folder read, admitted through the root session. */
export default hostedTools(EXPLORER_TOOL_NAMES, host.admitDelegated);
