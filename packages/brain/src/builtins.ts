import { RESPONSES_ITEM_FORMAT } from "@sidecar/runtime";
import {
  type AgentRuntime,
  type ExecutionRuntime,
  type ModelAdapter,
  promiseAgentRuntime,
} from "@sidecar/runtime/vocabulary";
import { ResponsesContextEngine } from "./context-engine.js";
import { ToolLoopAgentRuntime } from "./runtime.js";

/**
 * The runtime this build ships, behind the id `@sidecar/runtime`'s `BUILTINS`
 * names it under: the tool loop over the Responses context engine. It is
 * built here rather than beside the table because the runtime package must
 * not reach the brain to build one. The model adapters have no counterpart
 * here on purpose: the credential policy builds those from the credential a
 * configuration's reference names. The table's other context engine, the
 * derivation over stored UIMessages, is constructed behind
 * `@sidecar/brain/ui-message-context` rather than here, because it reaches
 * the AI SDK at run time and the barrel must not.
 *
 * The execution is the runtime every run of this loop is a fiber on. A host
 * that composes one hands its own, so a turn's fiber and the host that
 * cancels it stand on one runtime; a caller that hands none runs on Effect's
 * default, which is what a test building a loop by hand wants.
 */
export function toolLoopRuntimeOver(
  model: ModelAdapter,
  execution?: ExecutionRuntime,
): AgentRuntime {
  return promiseAgentRuntime(
    new ToolLoopAgentRuntime({
      model,
      itemFormat: RESPONSES_ITEM_FORMAT,
      createContext: (format) =>
        new ResponsesContextEngine({ id: format.runtime, version: format.runtimeVersion }),
    }),
    execution ? { execution } : {},
  );
}
