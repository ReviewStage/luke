import { RESEARCHER_TOOL_NAMES } from "../../../../server/hosted/brain-host/planning.js";
import { hostedTools } from "../../../tools/brain.js";

/** The researcher's tools: the planning model's own public reads, admitted through the root session. */
export default hostedTools(RESEARCHER_TOOL_NAMES);
