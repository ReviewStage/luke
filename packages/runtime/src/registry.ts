import type {
  AgentRuntime,
  CheckpointFormat,
  ContextEngine,
  ModelAdapter,
  ToolSchema,
} from "@sidecar/runtime-contracts";

/**
 * The extension boundaries of the runtime, each a registry of descriptors
 * under fixed ids. A registry holds what a build compiled in — the built-in
 * runtimes, adapters, engines, memory providers, tools, skills, and
 * lifecycle services — and a configuration names entries by id rather than
 * constructing anything itself. Every registry refuses a second entry under
 * an id it holds, so two built-ins can never race for a name, and each kind
 * refuses the combinations its capabilities rule out at registration, so an
 * impossible pairing is a build error rather than a run that fails later.
 * Nothing here loads code: a descriptor is a value the build wrote, and
 * dynamic third-party loading is a decision this build has not made.
 */

export const REGISTRY_KIND = {
  AGENT_RUNTIME: "agent-runtime",
  MODEL_ADAPTER: "model-adapter",
  CONTEXT_ENGINE: "context-engine",
  MEMORY_PROVIDER: "memory-provider",
  TOOL: "tool",
  SKILL: "skill",
  LIFECYCLE_SERVICE: "lifecycle-service",
} as const;

export type RegistryKind = (typeof REGISTRY_KIND)[keyof typeof REGISTRY_KIND];

export const REGISTRATION_REFUSAL = {
  DUPLICATE_ID: "duplicate-id",
  EMPTY_ID: "empty-id",
  INCOMPATIBLE: "incompatible",
} as const;

export type RegistrationRefusal = (typeof REGISTRATION_REFUSAL)[keyof typeof REGISTRATION_REFUSAL];

export class RegistrationError extends Error {
  readonly kind: RegistryKind;
  readonly refusal: RegistrationRefusal;
  readonly id: string;

  constructor(kind: RegistryKind, refusal: RegistrationRefusal, id: string, detail?: string) {
    super(`${kind} "${id}" refused: ${refusal}${detail ? ` (${detail})` : ""}`);
    this.name = "RegistrationError";
    this.kind = kind;
    this.refusal = refusal;
    this.id = id;
  }
}

export interface Registered {
  readonly id: string;
}

/** Answers why an entry may not join the entries already held, or nothing when it may. */
export type CompatibilityRule<Entry extends Registered> = (
  entry: Entry,
  held: readonly Entry[],
) => string | undefined;

export class Registry<Entry extends Registered> {
  readonly kind: RegistryKind;
  readonly #entries = new Map<string, Entry>();
  readonly #compatible: CompatibilityRule<Entry> | undefined;

  constructor(kind: RegistryKind, compatible?: CompatibilityRule<Entry>) {
    this.kind = kind;
    this.#compatible = compatible;
  }

  register(entry: Entry): Entry {
    if (entry.id.length === 0) {
      throw new RegistrationError(this.kind, REGISTRATION_REFUSAL.EMPTY_ID, entry.id);
    }
    if (this.#entries.has(entry.id)) {
      throw new RegistrationError(this.kind, REGISTRATION_REFUSAL.DUPLICATE_ID, entry.id);
    }
    const objection = this.#compatible?.(entry, [...this.#entries.values()]);
    if (objection !== undefined) {
      throw new RegistrationError(
        this.kind,
        REGISTRATION_REFUSAL.INCOMPATIBLE,
        entry.id,
        objection,
      );
    }
    this.#entries.set(entry.id, entry);
    return entry;
  }

  get(id: string): Entry | undefined {
    return this.#entries.get(id);
  }

  has(id: string): boolean {
    return this.#entries.has(id);
  }

  ids(): readonly string[] {
    return [...this.#entries.keys()];
  }

  entries(): readonly Entry[] {
    return [...this.#entries.values()];
  }
}

/** The item format a runtime writes and an engine reads; both name it so a pairing can be checked. */
export interface ItemFormatIdentity {
  readonly format: string;
  readonly version: number;
}

export interface AgentRuntimeDescriptor extends Registered {
  readonly itemFormat: ItemFormatIdentity;
  /** Builds the runtime over the adapter and engine a configuration resolved. */
  readonly create: (model: ModelAdapter, engine: ContextEngineDescriptor) => AgentRuntime;
}

export interface ModelAdapterDescriptor extends Registered {
  /** The checkpoint format the adapter's items travel in; a runtime of another format cannot carry them. */
  readonly itemFormat: ItemFormatIdentity;
  /** The kind of credential the adapter runs under, by reference: the value stays in the credential store. */
  readonly credentialKind: string;
  /** Whether the adapter's transport fixes the tool catalog it carries; a name outside it refuses the request. */
  readonly fixedToolCatalog: boolean;
}

export interface ContextEngineDescriptor extends Registered {
  readonly itemFormat: ItemFormatIdentity;
  readonly create: (writer: { id: string; version: number }) => ContextEngine;
  readonly checkpointFormatFor: (runtime: { id: string; version: number }) => CheckpointFormat;
}

export const MEMORY_CAPABILITY = {
  KEYWORD: "keyword",
  VECTOR: "vector",
  NOTEBOOK: "notebook",
} as const;

export type MemoryCapability = (typeof MEMORY_CAPABILITY)[keyof typeof MEMORY_CAPABILITY];

export interface MemoryProviderDescriptor extends Registered {
  readonly capabilities: readonly MemoryCapability[];
  /** A vector provider needs an embedding adapter; naming none is the incompatibility the registry refuses. */
  readonly embeddingAdapterId?: string;
}

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

/** A tool as the registry holds it: its schema as a model is offered it, where it runs, and what it does. */
export interface ToolDescriptor extends Registered {
  readonly schema: ToolSchema;
  readonly execution: ToolExecution;
  readonly effect: ToolEffect;
  /** Groups the policy may name in place of the tool: `group:read`, `group:acts`, and so on. */
  readonly groups: readonly string[];
}

export interface SkillDescriptor extends Registered {
  readonly name: string;
  readonly description: string;
  /** The absolute path of the skill's SKILL.md, loaded on demand and never inlined into a prompt. */
  readonly location: string;
  /** Whether the skill is offered at all; a disabled skill is listed to no run. */
  readonly enabled: boolean;
  /** Agents the skill is limited to; empty means every agent. */
  readonly agents: readonly string[];
}

export const LIFECYCLE_HOOK = {
  BEFORE_COMPACTION: "before-compaction",
  AFTER_TURN: "after-turn",
  ON_RESET: "on-reset",
} as const;

export type LifecycleHook = (typeof LIFECYCLE_HOOK)[keyof typeof LIFECYCLE_HOOK];

export interface LifecycleServiceDescriptor extends Registered {
  readonly hooks: readonly LifecycleHook[];
}

function sameItemFormat(left: ItemFormatIdentity, right: ItemFormatIdentity): boolean {
  return left.format === right.format && left.version === right.version;
}

export { sameItemFormat };

/** A tool's schema name is its id: a descriptor whose two names disagree would be offered under one and dispatched under the other. */
const toolCompatible: CompatibilityRule<ToolDescriptor> = (entry, held) => {
  if (entry.schema.name !== entry.id) return "schema name differs from id";
  if (entry.execution === TOOL_EXECUTION.PERFORMER && entry.effect === TOOL_EFFECT.SPEAK) {
    return "a performer tool cannot speak";
  }
  if (entry.execution === TOOL_EXECUTION.WORKSPACE && entry.effect === TOOL_EFFECT.SPEAK) {
    return "a workspace tool cannot speak";
  }
  return held.some((other) => other.schema.name === entry.schema.name)
    ? "schema name already registered"
    : undefined;
};

const memoryCompatible: CompatibilityRule<MemoryProviderDescriptor> = (entry) =>
  entry.capabilities.includes(MEMORY_CAPABILITY.VECTOR) && !entry.embeddingAdapterId
    ? "a vector provider names no embedding adapter"
    : undefined;

const skillCompatible: CompatibilityRule<SkillDescriptor> = (entry, held) => {
  if (entry.name.length === 0) return "a skill needs a name";
  return held.some((other) => other.location === entry.location)
    ? "location already registered"
    : undefined;
};

/** Every registry the runtime resolves a configuration against. */
export interface RuntimeRegistries {
  readonly agentRuntimes: Registry<AgentRuntimeDescriptor>;
  readonly modelAdapters: Registry<ModelAdapterDescriptor>;
  readonly contextEngines: Registry<ContextEngineDescriptor>;
  readonly memoryProviders: Registry<MemoryProviderDescriptor>;
  readonly tools: Registry<ToolDescriptor>;
  readonly skills: Registry<SkillDescriptor>;
  readonly lifecycleServices: Registry<LifecycleServiceDescriptor>;
}

export function createRuntimeRegistries(): RuntimeRegistries {
  return {
    agentRuntimes: new Registry(REGISTRY_KIND.AGENT_RUNTIME),
    modelAdapters: new Registry(REGISTRY_KIND.MODEL_ADAPTER),
    contextEngines: new Registry(REGISTRY_KIND.CONTEXT_ENGINE),
    memoryProviders: new Registry(REGISTRY_KIND.MEMORY_PROVIDER, memoryCompatible),
    tools: new Registry(REGISTRY_KIND.TOOL, toolCompatible),
    skills: new Registry(REGISTRY_KIND.SKILL, skillCompatible),
    lifecycleServices: new Registry(REGISTRY_KIND.LIFECYCLE_SERVICE),
  };
}
