/**
 * The runtime's vocabulary: the identities it keeps apart, what one inference
 * reports about itself, and the units of time. A re-export door and nothing else,
 * Node-free by construction, because packages below the runtime import this
 * door, so a Node-reaching name cannot follow a string constant into a
 * renderer bundle.
 */

export type { ModelUsage, ReasoningSummary, ToolInvocation } from "./execution.js";
export { DEFAULT_AGENT_ID, type SessionKey, sessionKey } from "./identifiers.js";
export { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS } from "./timers.js";
