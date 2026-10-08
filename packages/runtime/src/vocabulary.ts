/**
 * The runtime's vocabulary: the identities it keeps apart, what one inference
 * reports about itself, the compaction sources a transcript records, and the
 * day. A re-export door and nothing else, Node-free by construction, because
 * packages below the runtime import this door, so a Node-reaching name cannot
 * follow a string constant into a renderer bundle.
 */

export type { ModelUsage, ReasoningSummary, ToolInvocation } from "./execution.js";
export { type AgentId, DEFAULT_AGENT_ID, type SessionKey, sessionKey } from "./identifiers.js";
export { COMPACTION_SOURCE, type CompactionSource } from "./storage.js";
export { DAY_MS } from "./timers.js";
