import { RESPONSES_ITEM_FORMAT } from "@sidecar/runtime";
import type { AgentRuntime, ModelAdapter } from "@sidecar/runtime/vocabulary";
import { ResponsesContextEngine } from "./context-engine.js";
import { ToolLoopAgentRuntime } from "./runtime.js";

/**
 * The runtime this build ships, behind the id `@sidecar/runtime`'s `BUILTINS`
 * names it under: the tool loop over the Responses context engine. It is
 * built here rather than beside the table because the runtime package must
 * not reach the brain to build one. The model adapters have no counterpart
 * here on purpose: the credential policy builds those from the credential a
 * configuration's reference names.
 */
export function toolLoopRuntimeOver(model: ModelAdapter): AgentRuntime {
  return new ToolLoopAgentRuntime({
    model,
    itemFormat: RESPONSES_ITEM_FORMAT,
    createContext: (format) =>
      new ResponsesContextEngine({ id: format.runtime, version: format.runtimeVersion }),
  });
}
