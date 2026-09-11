import {
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDERS,
  type CredentialProvider,
  type CredentialProviderId,
} from "@sidecar/credentials/vocabulary";
import { PROVIDER_ID, type ProviderId, type SessionProviderPlugin } from "@sidecar/session";
import { Effect } from "effect";
import { CLAUDE_HOOK_EVENT, installClaudeCodeObservationHooks } from "./claude-code/hooks.js";
import { CODEX_HOOK_EVENT, installCodexObservationHooks } from "./codex/hooks.js";
import { conductorPlugin } from "./conductor/index.js";
import { builtProviders } from "./effect/registry.js";
import type { ObservationHookProviderId } from "./hook-registry.js";
import { localSessionAdapters } from "./local-adapters.js";
import type {
  AdapterDiagnosticCallback,
  AdapterDiagnosticKind,
} from "./shared/adapter-diagnostics.js";
import {
  HOOK_SPOOL_MAXIMUM_AGE_MS,
  type ObservationHookInstallation,
  pruneObservationHookSpool,
} from "./shared/hook-merge.js";

/**
 * Where a hooked provider's observation spool lives and which tokens its hook
 * may write, so a watcher can stand on the spool the registration converged.
 */
export interface ProviderObservationSpool {
  directory: () => string;
  events: readonly string[];
}

export interface ProviderRegistration {
  plugin: SessionProviderPlugin;
  credential?: CredentialProvider;
  registerObservationHook?: () => Promise<void>;
  observationSpool?: ProviderObservationSpool;
}

export interface ProviderRegistrationOptions {
  readApiKey: (providerId: CredentialProviderId) => Promise<string | undefined>;
  observationHookInstallation: (
    providerId: ObservationHookProviderId,
  ) => ObservationHookInstallation;
  /**
   * Where every cloud adapter constructed here lands its diagnostic channel,
   * tagged with the provider it came from. Absent, diagnostics reach nobody,
   * which is what a fixture run wants.
   */
  onDiagnostic?: (providerId: ProviderId, kind: AdapterDiagnosticKind, error: Error) => void;
  now?: () => number;
}

function adapterDiagnostics(
  providerId: ProviderId,
  onDiagnostic: ProviderRegistrationOptions["onDiagnostic"],
): { onDiagnostic: AdapterDiagnosticCallback } | undefined {
  return onDiagnostic
    ? { onDiagnostic: (kind, error) => onDiagnostic(providerId, kind, error) }
    : undefined;
}

/**
 * One provider's launch convergence: install the arrangement, then prune the
 * spool it writes into, so the spool's size tracks the sessions actually
 * alive rather than every session ever observed.
 */
function observationHookRegistration(
  installHooks: (installation: ObservationHookInstallation) => Promise<void>,
  installation: () => ObservationHookInstallation,
  now: () => number,
): () => Promise<void> {
  return async () => {
    const resolved = installation();
    await installHooks(resolved);
    await pruneObservationHookSpool(resolved.spoolDirectory, HOOK_SPOOL_MAXIMUM_AGE_MS, now());
  };
}

/**
 * Every registration this package ships, in the order the provider catalog
 * lists them. It is one layer each in `providersLayer`, which is where a
 * duplicate id is refused.
 */
function providerDeclarations(
  options: ProviderRegistrationOptions,
): readonly ProviderRegistration[] {
  const now = options.now ?? Date.now;
  const hookInstallation = (providerId: ObservationHookProviderId) => () =>
    options.observationHookInstallation(providerId);
  const claudeInstallation = hookInstallation(PROVIDER_ID.CLAUDE_CODE);
  const codexInstallation = hookInstallation(PROVIDER_ID.CODEX);
  // The on-disk adapters come from the shared table the keyless peek also
  // builds from, here with each hooked provider's spool to sharpen its read.
  const locals = localSessionAdapters({
    hookEventsDirectory: (providerId) => () =>
      options.observationHookInstallation(providerId).spoolDirectory,
  });
  return [
    {
      plugin: locals.claudeCode,
      registerObservationHook: observationHookRegistration(
        installClaudeCodeObservationHooks,
        claudeInstallation,
        now,
      ),
      observationSpool: {
        directory: () => claudeInstallation().spoolDirectory,
        events: Object.values(CLAUDE_HOOK_EVENT),
      },
    },
    {
      plugin: locals.codexLocal,
      registerObservationHook: observationHookRegistration(
        installCodexObservationHooks,
        codexInstallation,
        now,
      ),
      observationSpool: {
        directory: () => codexInstallation().spoolDirectory,
        events: Object.values(CODEX_HOOK_EVENT),
      },
    },
    {
      plugin: conductorPlugin({
        readApiKey: () => options.readApiKey(CREDENTIAL_PROVIDER_ID.CONDUCTOR),
        ...adapterDiagnostics(PROVIDER_ID.CONDUCTOR, options.onDiagnostic),
      }),
      credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.CONDUCTOR],
    },
    // OMP's JSONL recordings already say whose move it is: message roles,
    // unmatched tool_execution_start, and session_exit. No observation hook.
    { plugin: locals.omp },
  ];
}

/**
 * A registration the built registry has to hold. The record below states
 * every provider id the catalog names, so an id the merge did not produce is
 * a registry that never assembled rather than a lookup answering nothing.
 */
function standing(
  registry: ReadonlyMap<string, ProviderRegistration>,
  providerId: ProviderId,
): ProviderRegistration {
  const registration = registry.get(providerId);
  if (registration === undefined) throw new Error(`no registration for ${providerId}`);
  return registration;
}

/**
 * @deprecated The registry is `providersLayer` in `./effect/registry.js`, and
 * the host takes it as a `Layer` in P7-01 and P7-02, which delete this door.
 * Until then the composers that hold it are promises reading a record, so the
 * layers are built and read here — the shim is the edge for as long as it
 * exists, and the build is synchronous because every registration is.
 */
export function providerRegistrations(options: ProviderRegistrationOptions) {
  const registry = Effect.runSync(
    Effect.orDie(Effect.scoped(builtProviders(providerDeclarations(options)))),
  );
  return {
    [PROVIDER_ID.CLAUDE_CODE]: standing(registry, PROVIDER_ID.CLAUDE_CODE),
    [PROVIDER_ID.CODEX]: standing(registry, PROVIDER_ID.CODEX),
    [PROVIDER_ID.CONDUCTOR]: standing(registry, PROVIDER_ID.CONDUCTOR),
    [PROVIDER_ID.OMP]: standing(registry, PROVIDER_ID.OMP),
  } satisfies Readonly<Record<ProviderId, ProviderRegistration>>;
}
