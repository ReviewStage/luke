import type { ToolSet } from "ai";
import { brainToolSet } from "../agents/brain-host/brain.js";

/**
 * Every tool a hosted conversation's rows may name: the brain's,
 * built once for the deployment. The writer holds every row to this, and a
 * task conversation is read back under it.
 */
export const HOSTED_TOOL_SET: ToolSet = brainToolSet();
