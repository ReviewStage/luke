import {
  type AgentRuntimeDescriptor,
  type ContextEngineDescriptor,
  CREDENTIAL_REFERENCE_KIND,
  MEMORY_CAPABILITY,
  type MemoryProviderDescriptor,
  type ModelAdapterDescriptor,
  type RuntimeRegistries,
} from "@sidecar/runtime";
import { ResponsesContextEngine } from "./context-engine.js";
import { HOSTED_EMBEDDING_ADAPTER_ID, OPENAI_EMBEDDING_ADAPTER_ID } from "./embedding-adapters.js";
import { HOSTED_MODEL_ADAPTER_ID } from "./hosted-model-adapter.js";
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

export const TOOL_LOOP_RUNTIME_DESCRIPTOR: AgentRuntimeDescriptor = {
  id: TOOL_LOOP_RUNTIME.ID,
  itemFormat: RESPONSES_ITEM_FORMAT_IDENTITY,
  create: (model, engine) =>
    new ToolLoopAgentRuntime({
      model,
      itemFormat: engine.itemFormat,
      createContext: (format) =>
        engine.create({ id: format.runtime, version: format.runtimeVersion }),
    }),
};

export const RESPONSES_CONTEXT_ENGINE_DESCRIPTOR: ContextEngineDescriptor = {
  id: RESPONSES_CONTEXT_ENGINE_ID,
  itemFormat: RESPONSES_ITEM_FORMAT_IDENTITY,
  create: (writer) => new ResponsesContextEngine(writer),
};

const OPENAI_MODEL_ADAPTER_DESCRIPTOR: ModelAdapterDescriptor = {
  id: OPENAI_MODEL_ADAPTER_ID,
  itemFormat: RESPONSES_ITEM_FORMAT_IDENTITY,
  credentialKind: CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY,
};

const HOSTED_MODEL_ADAPTER_DESCRIPTOR: ModelAdapterDescriptor = {
  id: HOSTED_MODEL_ADAPTER_ID,
  itemFormat: RESPONSES_ITEM_FORMAT_IDENTITY,
  credentialKind: CREDENTIAL_REFERENCE_KIND.HOSTED_ACCOUNT,
};

/**
 * The notebook index as a memory provider, one registration per embedding
 * adapter it may run vectors on: keyword search over the FTS5 shadow, vector
 * search over the stored embeddings, and the notebook's own writes. A
 * configuration names the one matching its credential, as it names the
 * model adapter, and the registry refuses a vector provider that names no
 * embedding adapter.
 */
export const NOTEBOOK_MEMORY_PROVIDER_ID = {
  OPENAI: "notebook-index-openai",
  HOSTED: "notebook-index-hosted",
} as const;

export type NotebookMemoryProviderId =
  (typeof NOTEBOOK_MEMORY_PROVIDER_ID)[keyof typeof NOTEBOOK_MEMORY_PROVIDER_ID];

const NOTEBOOK_MEMORY_CAPABILITIES = [
  MEMORY_CAPABILITY.KEYWORD,
  MEMORY_CAPABILITY.VECTOR,
  MEMORY_CAPABILITY.NOTEBOOK,
] as const;

export function notebookMemoryProviderDescriptors(): readonly MemoryProviderDescriptor[] {
  return [
    {
      id: NOTEBOOK_MEMORY_PROVIDER_ID.OPENAI,
      capabilities: NOTEBOOK_MEMORY_CAPABILITIES,
      embeddingAdapterId: OPENAI_EMBEDDING_ADAPTER_ID,
    },
    {
      id: NOTEBOOK_MEMORY_PROVIDER_ID.HOSTED,
      capabilities: NOTEBOOK_MEMORY_CAPABILITIES,
      embeddingAdapterId: HOSTED_EMBEDDING_ADAPTER_ID,
    },
  ];
}

/** The notebook provider a credential runs on: the same split the model adapter makes. */
export function notebookMemoryProviderFor(credentialKind: string): NotebookMemoryProviderId {
  return credentialKind === CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY
    ? NOTEBOOK_MEMORY_PROVIDER_ID.OPENAI
    : NOTEBOOK_MEMORY_PROVIDER_ID.HOSTED;
}

/** Registers every built-in into the registries given; answers them for chaining. */
export function registerBrainBuiltIns(registries: RuntimeRegistries): RuntimeRegistries {
  registries.agentRuntimes.register(TOOL_LOOP_RUNTIME_DESCRIPTOR);
  registries.contextEngines.register(RESPONSES_CONTEXT_ENGINE_DESCRIPTOR);
  registries.modelAdapters.register(OPENAI_MODEL_ADAPTER_DESCRIPTOR);
  registries.modelAdapters.register(HOSTED_MODEL_ADAPTER_DESCRIPTOR);
  for (const tool of brainToolCatalog()) registries.tools.register(tool);
  for (const provider of notebookMemoryProviderDescriptors()) {
    registries.memoryProviders.register(provider);
  }
  return registries;
}
