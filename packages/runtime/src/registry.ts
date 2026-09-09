import type { ReasoningEffort, ToolSchema } from "./execution.js";
import { type AgentId, DEFAULT_AGENT_ID } from "./identifiers.js";
import type { ToolPolicyLayers } from "./tool-policy.js";

/**
 * What this build compiled in, under the ids a configuration names, and how
 * a configuration becomes the immutable snapshot a run reads. A
 * configuration names built-ins by id and a credential by reference;
 * resolving it checks every name against the built-ins and its own numbers,
 * and answers a frozen snapshot or the one reason it cannot stand. A store
 * publishes snapshots atomically: a run takes the snapshot standing when it
 * opens and reads it alone to its end, a publish replaces the whole snapshot
 * at once, and a configuration that fails to resolve replaces nothing; a
 * caller reads the snapshot it needs after its publish, and nothing is
 * notified. The credential itself never enters a configuration: the
 * reference says which credential, and the encrypted credential store keeps
 * the value.
 */

/** The item format a runtime writes and an engine reads. */
export interface ItemFormatIdentity {
  readonly format: string;
  readonly version: number;
}

/** The item format every built-in of this build speaks: the Responses input array, first shape. */
export const RESPONSES_ITEM_FORMAT = {
  format: "openai-responses-input",
  version: 1,
} as const satisfies ItemFormatIdentity;

/** The tool-loop runtime's identity, as a checkpoint is stamped with it. */
export const TOOL_LOOP_RUNTIME = { ID: "tool-loop", VERSION: 1 } as const;

/** The one context engine this build compiles in: the Responses input array. */
export const BUILTIN_CONTEXT_ENGINE = { RESPONSES: "openai-responses" } as const;

/** The two model adapters: the developer's own OpenAI key, and Luke's hosted service. */
export const BUILTIN_MODEL_ADAPTER = {
  OPENAI: "openai-responses",
  HOSTED: "hosted-responses",
} as const;

/**
 * The notebook index as a memory provider, one id per embedding adapter it
 * may run vectors on: keyword search over the FTS5 shadow, vector search
 * over the stored embeddings, and the notebook's own writes. A configuration
 * names the one matching its credential, as it names the model adapter.
 */
export const BUILTIN_MEMORY_PROVIDER = {
  OPENAI: "notebook-index-openai",
  HOSTED: "notebook-index-hosted",
} as const;

/** The two embedding adapters the notebook providers name. */
export const BUILTIN_EMBEDDING_ADAPTER = {
  OPENAI: "openai-embeddings",
  HOSTED: "hosted-embeddings",
} as const;

/** How a tool's call is carried out: inside the host, by the host's act performer, or against the agent's own workspace files. */
export const TOOL_EXECUTION = {
  HOST: "host",
  PERFORMER: "performer",
  WORKSPACE: "workspace",
} as const;

export type ToolExecution = (typeof TOOL_EXECUTION)[keyof typeof TOOL_EXECUTION];

export const TOOL_EFFECT = {
  READ: "read",
  WRITE: "write",
  SPEAK: "speak",
} as const;

export type ToolEffect = (typeof TOOL_EFFECT)[keyof typeof TOOL_EFFECT];

/** A tool as the catalog holds it: its schema as a model is offered it, where it runs, and what it does. */
export interface ToolDescriptor {
  readonly id: string;
  readonly schema: ToolSchema;
  readonly execution: ToolExecution;
  readonly effect: ToolEffect;
  /** Groups the policy may name in place of the tool: `group:read`, `group:acts`, and so on. */
  readonly groups: readonly string[];
}

export interface SkillDescriptor {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** The absolute path of the skill's SKILL.md, loaded on demand and never inlined into a prompt. */
  readonly location: string;
  /** Whether the skill is offered at all; a disabled skill is listed to no run. */
  readonly enabled: boolean;
  /** Agents the skill is limited to; empty means every agent. */
  readonly agents: readonly string[];
}

export const MEMORY_CAPABILITY = {
  KEYWORD: "keyword",
  VECTOR: "vector",
  NOTEBOOK: "notebook",
} as const;

export type MemoryCapability = (typeof MEMORY_CAPABILITY)[keyof typeof MEMORY_CAPABILITY];

export const CREDENTIAL_REFERENCE_KIND = {
  /** The developer's own provider key, held encrypted under the credential provider named. */
  PROVIDER_KEY: "provider-key",
  /** Luke's hosted service, under the signed-in account's bearer token. */
  HOSTED_ACCOUNT: "hosted-account",
} as const;

export type CredentialReferenceKind =
  (typeof CREDENTIAL_REFERENCE_KIND)[keyof typeof CREDENTIAL_REFERENCE_KIND];

export type CredentialReference =
  | { readonly kind: typeof CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY; readonly providerId: string }
  | { readonly kind: typeof CREDENTIAL_REFERENCE_KIND.HOSTED_ACCOUNT };

interface BuiltinModelAdapter {
  /** The kind of credential the adapter runs under, by reference: the value stays in the credential store. */
  readonly credentialKind: CredentialReferenceKind;
}

interface BuiltinMemoryProvider {
  readonly capabilities: readonly MemoryCapability[];
  /**
   * The embedding adapter a vector provider runs its vectors on. Required,
   * not optional: a vector provider that named none was the one pairing the
   * old registry refused at run time, and a required field is the same rule
   * as a type error.
   */
  readonly embeddingAdapterId: string;
}

interface Builtins {
  readonly agentRuntimeIds: readonly string[];
  readonly contextEngineIds: readonly string[];
  readonly modelAdapters: Readonly<Record<string, BuiltinModelAdapter>>;
  readonly memoryProviders: Readonly<Record<string, BuiltinMemoryProvider>>;
}

const NOTEBOOK_MEMORY_CAPABILITIES = [
  MEMORY_CAPABILITY.KEYWORD,
  MEMORY_CAPABILITY.VECTOR,
  MEMORY_CAPABILITY.NOTEBOOK,
] as const;

/**
 * The built-ins by kind, under the ids a configuration names. The
 * constructors that turn a name into a runtime or an engine live in the
 * package that owns them (`@sidecar/brain`), because this table is names and
 * capabilities, never behavior. Nothing is registered at run time: dynamic
 * third-party loading is a decision this build has not made, so the table is
 * a const and a second entry under one id is a syntax error. Runtimes and
 * engines are kept apart from adapters because the ids collide across kinds:
 * the Responses context engine and the keyed model adapter are both
 * `openai-responses`.
 */
export const BUILTINS = {
  agentRuntimeIds: [TOOL_LOOP_RUNTIME.ID],
  contextEngineIds: [BUILTIN_CONTEXT_ENGINE.RESPONSES],
  modelAdapters: {
    [BUILTIN_MODEL_ADAPTER.OPENAI]: {
      credentialKind: CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY,
    },
    [BUILTIN_MODEL_ADAPTER.HOSTED]: {
      credentialKind: CREDENTIAL_REFERENCE_KIND.HOSTED_ACCOUNT,
    },
  },
  memoryProviders: {
    [BUILTIN_MEMORY_PROVIDER.OPENAI]: {
      capabilities: NOTEBOOK_MEMORY_CAPABILITIES,
      embeddingAdapterId: BUILTIN_EMBEDDING_ADAPTER.OPENAI,
    },
    [BUILTIN_MEMORY_PROVIDER.HOSTED]: {
      capabilities: NOTEBOOK_MEMORY_CAPABILITIES,
      embeddingAdapterId: BUILTIN_EMBEDDING_ADAPTER.HOSTED,
    },
  },
} as const satisfies Builtins;

export type BuiltinAgentRuntimeId = (typeof BUILTINS.agentRuntimeIds)[number];
export type BuiltinContextEngineId = (typeof BUILTINS.contextEngineIds)[number];
export type BuiltinModelAdapterId = keyof typeof BUILTINS.modelAdapters;
export type BuiltinMemoryProviderId = keyof typeof BUILTINS.memoryProviders;

export interface AgentConfiguration {
  readonly agentId: AgentId;
  readonly agentRuntimeId: string;
  readonly modelAdapterId: string;
  readonly contextEngineId: string;
  readonly memoryProviderId?: string;
  readonly credential: CredentialReference;
  /** The agent's identity workspace: the directory its bootstrap files live in. */
  readonly workspaceDirectory: string;
  /** Roots the skill discovery walks, each holding `<skill>/SKILL.md` directories. */
  readonly skillRoots: readonly string[];
  readonly toolPolicy: ToolPolicyLayers;
  readonly reasoningEffort?: ReasoningEffort;
  readonly maximumOutputTokens?: number;
}

export const CONFIGURATION_REFUSAL = {
  /** A name no built-in holds: only a name that arrived over the wire can be one. */
  UNKNOWN_ID: "unknown-id",
  CREDENTIAL_KIND_MISMATCH: "credential-kind-mismatch",
  INVALID_OUTPUT_TOKENS: "invalid-output-tokens",
  EMPTY_WORKSPACE: "empty-workspace",
} as const;

export type ConfigurationRefusal =
  (typeof CONFIGURATION_REFUSAL)[keyof typeof CONFIGURATION_REFUSAL];

/** A snapshot a run holds: the configuration as resolved, frozen, stamped with the revision it was published at. */
export interface ResolvedConfiguration {
  readonly revision: number;
  readonly configuration: AgentConfiguration;
}

function deepFreeze<Value>(value: Value): Value {
  if (!(value instanceof Object) || Object.isFrozen(value)) return value;
  for (const inner of Object.values(value)) deepFreeze(inner);
  return Object.freeze(value);
}

/**
 * The table read by id rather than by key, so a name that arrived over the
 * wire can be looked up without an assertion the derived unions would not
 * cover.
 */
const AGENT_RUNTIME_IDS: readonly string[] = BUILTINS.agentRuntimeIds;
const CONTEXT_ENGINE_IDS: readonly string[] = BUILTINS.contextEngineIds;
const MODEL_ADAPTERS: Readonly<Record<string, BuiltinModelAdapter>> = BUILTINS.modelAdapters;
const MEMORY_PROVIDERS: Readonly<Record<string, BuiltinMemoryProvider>> = BUILTINS.memoryProviders;

export const CONFIGURATION_OUTCOME = {
  RESOLVED: "resolved",
  REFUSED: "refused",
} as const;

export type ConfigurationOutcome =
  | {
      readonly outcome: typeof CONFIGURATION_OUTCOME.RESOLVED;
      readonly configuration: AgentConfiguration;
    }
  | {
      readonly outcome: typeof CONFIGURATION_OUTCOME.REFUSED;
      readonly refusal: ConfigurationRefusal;
    };

function refused(refusal: ConfigurationRefusal): ConfigurationOutcome {
  return { outcome: CONFIGURATION_OUTCOME.REFUSED, refusal };
}

/**
 * Checks the names a configuration gives against the built-ins and its own
 * numbers; answers the configuration frozen, or the one reason it cannot
 * stand. Only a name that arrived over the wire can be one the built-ins do
 * not hold: every name a build spells is checked by the derived id unions.
 */
export function resolveConfiguration(names: AgentConfiguration): ConfigurationOutcome {
  const adapter = MODEL_ADAPTERS[names.modelAdapterId];
  if (
    !AGENT_RUNTIME_IDS.includes(names.agentRuntimeId) ||
    !CONTEXT_ENGINE_IDS.includes(names.contextEngineId) ||
    !adapter ||
    (names.memoryProviderId !== undefined && !MEMORY_PROVIDERS[names.memoryProviderId])
  ) {
    return refused(CONFIGURATION_REFUSAL.UNKNOWN_ID);
  }
  if (adapter.credentialKind !== names.credential.kind) {
    return refused(CONFIGURATION_REFUSAL.CREDENTIAL_KIND_MISMATCH);
  }
  if (
    names.maximumOutputTokens !== undefined &&
    !(Number.isSafeInteger(names.maximumOutputTokens) && names.maximumOutputTokens > 0)
  ) {
    return refused(CONFIGURATION_REFUSAL.INVALID_OUTPUT_TOKENS);
  }
  if (names.workspaceDirectory.trim().length === 0) {
    return refused(CONFIGURATION_REFUSAL.EMPTY_WORKSPACE);
  }
  return {
    outcome: CONFIGURATION_OUTCOME.RESOLVED,
    configuration: deepFreeze(structuredClone(names)),
  };
}

/**
 * One agent's standing configuration. `publish` resolves and, only when the
 * whole configuration resolves, replaces the snapshot in one assignment; a
 * refused publish leaves the standing snapshot exactly as it was. Two agents
 * are two stores, so a test can stand two isolated agents beside each other
 * with nothing shared.
 */
export class ConfigurationStore {
  #snapshot: ResolvedConfiguration;

  constructor(initial: AgentConfiguration) {
    const resolved = resolveConfiguration(initial);
    if (resolved.outcome === CONFIGURATION_OUTCOME.REFUSED) {
      throw new Error(`initial configuration refused: ${resolved.refusal}`);
    }
    this.#snapshot = Object.freeze({ revision: 1, configuration: resolved.configuration });
  }

  snapshot(): ResolvedConfiguration {
    return this.#snapshot;
  }

  /**
   * Replaces the snapshot whole, or answers the one reason nothing was
   * replaced; the caller reads `snapshot()` for what now stands.
   */
  publish(next: AgentConfiguration): ConfigurationOutcome {
    const resolved = resolveConfiguration(next);
    if (resolved.outcome === CONFIGURATION_OUTCOME.RESOLVED) {
      this.#snapshot = Object.freeze({
        revision: this.#snapshot.revision + 1,
        configuration: resolved.configuration,
      });
    }
    return resolved;
  }
}

/** The one agent this build configures, over the ids the built-ins hold. */
export function defaultAgentConfiguration(options: {
  agentRuntimeId: BuiltinAgentRuntimeId;
  modelAdapterId: BuiltinModelAdapterId;
  contextEngineId: BuiltinContextEngineId;
  credential: CredentialReference;
  workspaceDirectory: string;
  skillRoots?: readonly string[];
  toolPolicy?: ToolPolicyLayers;
  memoryProviderId?: BuiltinMemoryProviderId;
  agentId?: AgentId;
  reasoningEffort?: ReasoningEffort;
  maximumOutputTokens?: number;
}): AgentConfiguration {
  return {
    agentId: options.agentId ?? DEFAULT_AGENT_ID,
    agentRuntimeId: options.agentRuntimeId,
    modelAdapterId: options.modelAdapterId,
    contextEngineId: options.contextEngineId,
    credential: options.credential,
    workspaceDirectory: options.workspaceDirectory,
    skillRoots: options.skillRoots ?? [],
    toolPolicy: options.toolPolicy ?? {},
    ...(options.memoryProviderId !== undefined
      ? { memoryProviderId: options.memoryProviderId }
      : undefined),
    ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : undefined),
    ...(options.maximumOutputTokens !== undefined
      ? { maximumOutputTokens: options.maximumOutputTokens }
      : undefined),
  };
}
