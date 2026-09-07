import type { AgentRuntime, ModelAdapter } from "@sidecar/runtime-contracts";
import { ResponsesContextEngine } from "./context-engine.js";
import type { LoopGuardConfig } from "./loop-guard.js";
import { RESPONSES_ITEM_FORMAT } from "./responses-api.js";
import { ToolLoopAgentRuntime } from "./runtime.js";

/**
 * The runtime this build ships: the tool loop over a Responses context
 * engine, on whichever model adapter the host built — the developer's own
 * key or Luke's hosted service, both of which speak the Responses item
 * shapes. A host composes it here so the pairing of loop and engine is made
 * in one place, and a different runtime is a different composition rather
 * than a change to the host.
 */
export function responsesToolLoopRuntime(
  model: ModelAdapter,
  loopGuard?: LoopGuardConfig,
): AgentRuntime {
  return new ToolLoopAgentRuntime({
    model,
    itemFormat: { format: RESPONSES_ITEM_FORMAT.FORMAT, version: RESPONSES_ITEM_FORMAT.VERSION },
    createContext: (format) =>
      new ResponsesContextEngine({ id: format.runtime, version: format.runtimeVersion }),
    ...(loopGuard ? { loopGuard } : undefined),
  });
}
