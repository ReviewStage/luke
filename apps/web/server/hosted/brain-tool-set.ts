import type { ToolSet } from "ai";
import { planningToolSet } from "./brain-host/planning.js";

/**
 * Every tool a hosted conversation's rows may name: the planning model's,
 * built once for the deployment. The writer holds every row to this, and a
 * plan conversation is read back under it.
 */
export const HOSTED_TOOL_SET: ToolSet = planningToolSet();
