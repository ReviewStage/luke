// The barrel carries only what the main process takes; the wire vocabulary
// travels through `./vocabulary`, its own door, because this barrel reaches
// `node:path` through the writer — which asks its caller for the `FileSystem`
// it writes through — and a renderer bundle must never resolve it.
export { AGENT_TRACE_DIRECTORY_VARIABLE, agentTraceDirectory } from "./trace-directory.js";
export {
  AgentTraceWriter,
  type SpeechTraceRecord,
} from "./trace-writer.js";
