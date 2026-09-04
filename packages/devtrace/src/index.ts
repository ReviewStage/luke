// The barrel carries only what the main process takes; the wire vocabulary
// travels through `./vocabulary`, its own door, because this barrel reaches
// `node:fs` through the writer and a renderer bundle must never resolve it.
export {
  AgentTraceWriter,
  type AgentTraceWriterOptions,
  TRACE_ENTRY_KIND,
  type TraceEntryKind,
} from "./trace-writer.js";
