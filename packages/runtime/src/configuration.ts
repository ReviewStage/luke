import { type AgentId, DEFAULT_AGENT_ID, type ReasoningEffort } from "@sidecar/runtime-contracts";
import { type RuntimeRegistries, sameItemFormat } from "./registry.js";
import type { ToolPolicyLayers } from "./tool-policy.js";

/**
 * What one agent is configured as, and how a configuration becomes the
 * immutable snapshot a run reads. A configuration names registry entries by
 * id and a credential by reference; resolving it checks every name against
 * the registries and every pairing against the capabilities the entries
 * declare, and answers a frozen snapshot or the reasons it cannot stand. A
 * store publishes snapshots atomically: a run takes the snapshot standing
 * when it opens and reads it alone to its end, a publish replaces the whole
 * snapshot at once, and a configuration that fails to resolve replaces
 * nothing; a caller reads the snapshot it needs after its publish, and
 * nothing is notified. The credential itself never enters a configuration: the reference
 * says which credential, and the encrypted credential store keeps the value.
 */

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
  readonly lifecycleServiceIds: readonly string[];
}

export const CONFIGURATION_REFUSAL = {
  UNKNOWN_RUNTIME: "unknown-runtime",
  UNKNOWN_MODEL_ADAPTER: "unknown-model-adapter",
  UNKNOWN_CONTEXT_ENGINE: "unknown-context-engine",
  UNKNOWN_MEMORY_PROVIDER: "unknown-memory-provider",
  UNKNOWN_LIFECYCLE_SERVICE: "unknown-lifecycle-service",
  ITEM_FORMAT_MISMATCH: "item-format-mismatch",
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

export type ConfigurationResolution =
  | { readonly ok: true; readonly configuration: AgentConfiguration }
  | { readonly ok: false; readonly refusals: readonly ConfigurationRefusal[] };

function deepFreeze<Value>(value: Value): Value {
  if (!(value instanceof Object) || Object.isFrozen(value)) return value;
  for (const inner of Object.values(value)) deepFreeze(inner);
  return Object.freeze(value);
}

/** Checks a configuration against the registries; answers it frozen, or every reason it cannot stand. */
export function resolveConfiguration(
  configuration: AgentConfiguration,
  registries: RuntimeRegistries,
): ConfigurationResolution {
  const refusals: ConfigurationRefusal[] = [];
  const runtime = registries.agentRuntimes.get(configuration.agentRuntimeId);
  const adapter = registries.modelAdapters.get(configuration.modelAdapterId);
  const engine = registries.contextEngines.get(configuration.contextEngineId);
  if (!runtime) refusals.push(CONFIGURATION_REFUSAL.UNKNOWN_RUNTIME);
  if (!adapter) refusals.push(CONFIGURATION_REFUSAL.UNKNOWN_MODEL_ADAPTER);
  if (!engine) refusals.push(CONFIGURATION_REFUSAL.UNKNOWN_CONTEXT_ENGINE);
  if (
    runtime &&
    engine &&
    adapter &&
    !(
      sameItemFormat(runtime.itemFormat, engine.itemFormat) &&
      sameItemFormat(runtime.itemFormat, adapter.itemFormat)
    )
  ) {
    refusals.push(CONFIGURATION_REFUSAL.ITEM_FORMAT_MISMATCH);
  }
  if (adapter && adapter.credentialKind !== configuration.credential.kind) {
    refusals.push(CONFIGURATION_REFUSAL.CREDENTIAL_KIND_MISMATCH);
  }
  if (
    configuration.memoryProviderId !== undefined &&
    !registries.memoryProviders.has(configuration.memoryProviderId)
  ) {
    refusals.push(CONFIGURATION_REFUSAL.UNKNOWN_MEMORY_PROVIDER);
  }
  if (configuration.lifecycleServiceIds.some((id) => !registries.lifecycleServices.has(id))) {
    refusals.push(CONFIGURATION_REFUSAL.UNKNOWN_LIFECYCLE_SERVICE);
  }
  if (
    configuration.maximumOutputTokens !== undefined &&
    !(
      Number.isSafeInteger(configuration.maximumOutputTokens) &&
      configuration.maximumOutputTokens > 0
    )
  ) {
    refusals.push(CONFIGURATION_REFUSAL.INVALID_OUTPUT_TOKENS);
  }
  if (configuration.workspaceDirectory.trim().length === 0) {
    refusals.push(CONFIGURATION_REFUSAL.EMPTY_WORKSPACE);
  }
  if (refusals.length > 0) return { ok: false, refusals };
  return { ok: true, configuration: deepFreeze(structuredClone(configuration)) };
}

/**
 * One agent's standing configuration. `publish` resolves and, only when the
 * whole configuration resolves, replaces the snapshot in one assignment; a
 * refused publish leaves the standing snapshot exactly as it was. Two agents
 * are two stores, so a test can stand two isolated agents beside each other
 * with nothing shared but the registries.
 */
export class ConfigurationStore {
  readonly #registries: RuntimeRegistries;
  #snapshot: ResolvedConfiguration;

  constructor(registries: RuntimeRegistries, initial: AgentConfiguration) {
    this.#registries = registries;
    const resolved = resolveConfiguration(initial, registries);
    if (!resolved.ok) {
      throw new Error(`initial configuration refused: ${resolved.refusals.join(", ")}`);
    }
    this.#snapshot = Object.freeze({ revision: 1, configuration: resolved.configuration });
  }

  snapshot(): ResolvedConfiguration {
    return this.#snapshot;
  }

  publish(next: AgentConfiguration): ConfigurationResolution {
    const resolved = resolveConfiguration(next, this.#registries);
    if (!resolved.ok) return resolved;
    this.#snapshot = Object.freeze({
      revision: this.#snapshot.revision + 1,
      configuration: resolved.configuration,
    });
    return resolved;
  }
}

/** The one agent this build configures, over the ids the built-ins register under. */
export function defaultAgentConfiguration(options: {
  agentRuntimeId: string;
  modelAdapterId: string;
  contextEngineId: string;
  credential: CredentialReference;
  workspaceDirectory: string;
  skillRoots?: readonly string[];
  toolPolicy?: ToolPolicyLayers;
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
    lifecycleServiceIds: [],
    ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : undefined),
    ...(options.maximumOutputTokens !== undefined
      ? { maximumOutputTokens: options.maximumOutputTokens }
      : undefined),
  };
}
