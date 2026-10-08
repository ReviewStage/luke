import { disableTool } from "eve/tools";

/**
 * No progress updates: each one wakes the planning session for a whole turn
 * of its own, and the worker's one result is what the planning model needs.
 */
export default disableTool();
