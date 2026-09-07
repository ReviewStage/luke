import {
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDERS,
  type CredentialProvider,
  type CredentialProviderId,
} from "@sidecar/credentials/vocabulary";
import {
  CompositeSessionProviderAdapter,
  PROVIDER_ID,
  type ProviderId,
  type SessionProviderAdapter,
} from "@sidecar/session";
import { CLAUDE_HOOK_EVENT, installClaudeCodeObservationHooks } from "./claude-code/hooks.js";
import { CODEX_PROVIDER } from "./codex/adapter.js";
import type { CodexCloudSessionAdapter } from "./codex/cloud-adapter.js";
import { CODEX_HOOK_EVENT, installCodexObservationHooks } from "./codex/hooks.js";
import { ConductorSessionAdapter } from "./conductor/adapter.js";
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
  adapter: SessionProviderAdapter;
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
   * Constructed by the caller rather than here, because the app also asks it
   * what the latest pass learned about the Codex CLI login — the settings
   * snapshot reports that beside the key sources — and the reference the
   * settings read is the reference the composite observes with.
   */
  codexCloudAdapter: CodexCloudSessionAdapter;
  /**
   * Where every cloud adapter constructed here lands its diagnostic channel,
   * tagged with the provider it came from. The `codexCloudAdapter` above is
   * the caller's to wire, at the construction the caller already owns. Absent,
   * diagnostics reach nobody, which is what a fixture run wants.
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

export function providerRegistrations(options: ProviderRegistrationOptions) {
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
  // Codex runs sessions in two places: on this machine, observed from its own
  // transcripts, and in Codex cloud, observed through the Codex CLI's
  // documented read under the ChatGPT login the user already gave that CLI.
  const codex = new CompositeSessionProviderAdapter({
    provider: CODEX_PROVIDER,
    adapters: [locals.codexLocal, options.codexCloudAdapter],
  });

  return {
    [PROVIDER_ID.CLAUDE_CODE]: {
      adapter: locals.claudeCode,
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
    [PROVIDER_ID.CODEX]: {
      adapter: codex,
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
    [PROVIDER_ID.CONDUCTOR]: {
      adapter: new ConductorSessionAdapter({
        readApiKey: () => options.readApiKey(CREDENTIAL_PROVIDER_ID.CONDUCTOR),
        ...adapterDiagnostics(PROVIDER_ID.CONDUCTOR, options.onDiagnostic),
      }),
      credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.CONDUCTOR],
    },
    // OMP's JSONL recordings already say whose move it is: message roles,
    // unmatched tool_execution_start, and session_exit. No observation hook.
    [PROVIDER_ID.OMP]: { adapter: locals.omp },
  } satisfies Readonly<Record<ProviderId, ProviderRegistration>>;
}
