import {
  BUILTIN_MEMORY_PROVIDER,
  type BuiltinMemoryProviderId,
  CREDENTIAL_REFERENCE_KIND,
  RESPONSES_ITEM_FORMAT,
} from "@sidecar/runtime";
import type { AgentRuntime, ModelAdapter } from "@sidecar/runtime/vocabulary";
import { ResponsesContextEngine } from "./context-engine.js";
import { ToolLoopAgentRuntime } from "./runtime.js";

/**
 * The constructors behind the ids `@sidecar/runtime`'s `BUILTINS` names. The
 * table holds names and capabilities; this file is the one place a name
 * becomes a running thing, because the runtime package must not reach the
 * brain to build one. The model adapters are absent on purpose: the
 * credential policy builds those from the credential a configuration's
 * reference names.
 */

/** The runtime this build ships: the tool loop over the Responses context engine. */
export function toolLoopRuntimeOver(model: ModelAdapter): AgentRuntime {
  return new ToolLoopAgentRuntime({
    model,
    itemFormat: RESPONSES_ITEM_FORMAT,
    createContext: (format) =>
      new ResponsesContextEngine({ id: format.runtime, version: format.runtimeVersion }),
  });
}

/** The notebook provider a credential runs on: the same split the model adapter makes. */
export function notebookMemoryProviderFor(credentialKind: string): BuiltinMemoryProviderId {
  return credentialKind === CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY
    ? BUILTIN_MEMORY_PROVIDER.OPENAI
    : BUILTIN_MEMORY_PROVIDER.HOSTED;
}
