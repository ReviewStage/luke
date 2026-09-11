// The barrel carries only what the main process takes; the wire vocabulary
// travels through `./vocabulary`, its own door, because this barrel reaches
// `node:fs` through the writer and a renderer bundle must never resolve it.
export { tracedModelAdapter } from "./brain-trace.js";
export { agentTraceDirectoryFromEnvironment } from "./trace-directory.js";
export {
  AgentTraceWriter,
  type SpeechTraceRecord,
} from "./trace-writer.js";
