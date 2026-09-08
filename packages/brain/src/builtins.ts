import {
  type AgentRuntimeDescriptor,
  type ContextEngineDescriptor,
  CREDENTIAL_REFERENCE_KIND,
  type ModelAdapterDescriptor,
  type RuntimeRegistries,
} from "@sidecar/runtime";
import { ResponsesContextEngine } from "./context-engine.js";
import { HOSTED_MODEL_ADAPTER_ID } from "./hosted-model-adapter.js";
import type { LoopGuardConfig } from "./loop-guard.js";
import { OPENAI_MODEL_ADAPTER_ID } from "./openai-model-adapter.js";
import { RESPONSES_ITEM_FORMAT } from "./responses-api.js";
import { TOOL_LOOP_RUNTIME, ToolLoopAgentRuntime } from "./runtime.js";
import { brainToolCatalog } from "./tools.js";

/**
 * What this build compiles in, registered under the ids a configuration
 * names: the tool loop runtime, the Responses context engine, the two model
 * adapters (the developer's own OpenAI key, and Luke's hosted service), and
 * the brain's tool catalog. Registering is a description, not a
 * construction: the adapters themselves are built by the credential policy
 * from the credential the reference names, and the runtime is built from the
 * engine descriptor the configuration resolved. A second registration of any
 * id is the registry's own refusal.
 */

export const RESPONSES_CONTEXT_ENGINE_ID = "openai-responses";

const RESPONSES_ITEM_FORMAT_IDENTITY = {
  format: RESPONSES_ITEM_FORMAT.FORMAT,
  version: RESPONSES_ITEM_FORMAT.VERSION,
} as const;

export interface BrainBuiltInOptions {
  loopGuard?: LoopGuardConfig;
}

export function toolLoopRuntimeDescriptor(
  options: BrainBuiltInOptions = {},
): AgentRuntimeDescriptor {
  return {
    id: TOOL_LOOP_RUNTIME.ID,
    itemFormat: RESPONSES_ITEM_FORMAT_IDENTITY,
    create: (model, engine) =>
      new ToolLoopAgentRuntime({
        model,
        itemFormat: engine.itemFormat,
        createContext: (format) =>
          engine.create({ id: format.runtime, version: format.runtimeVersion }),
        ...(options.loopGuard ? { loopGuard: options.loopGuard } : undefined),
      }),
  };
}

export function responsesContextEngineDescriptor(): ContextEngineDescriptor {
  return {
    id: RESPONSES_CONTEXT_ENGINE_ID,
    itemFormat: RESPONSES_ITEM_FORMAT_IDENTITY,
    create: (writer) => new ResponsesContextEngine(writer),
    checkpointFormatFor: (runtime) => ({
      runtime: runtime.id,
      runtimeVersion: runtime.version,
      format: RESPONSES_ITEM_FORMAT.FORMAT,
      formatVersion: RESPONSES_ITEM_FORMAT.VERSION,
    }),
  };
}

export function openAiModelAdapterDescriptor(): ModelAdapterDescriptor {
  return {
    id: OPENAI_MODEL_ADAPTER_ID,
    itemFormat: RESPONSES_ITEM_FORMAT_IDENTITY,
    credentialKind: CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY,
    fixedToolCatalog: false,
  };
}

export function hostedModelAdapterDescriptor(): ModelAdapterDescriptor {
  return {
    id: HOSTED_MODEL_ADAPTER_ID,
    itemFormat: RESPONSES_ITEM_FORMAT_IDENTITY,
    credentialKind: CREDENTIAL_REFERENCE_KIND.HOSTED_ACCOUNT,
    fixedToolCatalog: true,
  };
}

/** Registers every built-in into the registries given; answers them for chaining. */
export function registerBrainBuiltIns(
  registries: RuntimeRegistries,
  options: BrainBuiltInOptions = {},
): RuntimeRegistries {
  registries.agentRuntimes.register(toolLoopRuntimeDescriptor(options));
  registries.contextEngines.register(responsesContextEngineDescriptor());
  registries.modelAdapters.register(openAiModelAdapterDescriptor());
  registries.modelAdapters.register(hostedModelAdapterDescriptor());
  for (const tool of brainToolCatalog()) registries.tools.register(tool);
  return registries;
}
