import {
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDERS,
  type CredentialProvider,
  type CredentialProviderId,
} from "@sidecar/credentials/vocabulary";
import {
  CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  CompositeSessionProviderAdapter,
  PROVIDER_ID,
  type ProviderId,
  type SessionProviderAdapter,
  SUPERSET_WORKSPACE_PROVIDER_ID,
  type WorkspaceProviderId,
} from "@sidecar/session";
import { installClaudeCodeObservationHooks } from "./claude-code/hooks.js";
import { CODEX_PROVIDER } from "./codex/adapter.js";
import type { CodexCloudSessionAdapter } from "./codex/cloud-adapter.js";
import { installCodexObservationHooks } from "./codex/hooks.js";
import { ConductorSessionAdapter } from "./conductor/adapter.js";
import { ConductorLocalWorkspaceAdapter } from "./conductor/local-workspace-adapter.js";
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
 * How a registration's adapter joins the observation pass. Most adapters
 * report sessions the workspace hosts then annotate. A decorated adapter's
 * rows were already annotated by the host read that produced them, so
 * folding the hosts over them again would decorate them twice (Superset's
 * chatless workspace rows already carry their delete control). An adapter
 * that observes nothing is left out of the pass entirely: refreshing an
 * empty snapshot every pass would announce an unchanged roster.
 */
export const REGISTRATION_OBSERVATION = {
  HOST_ENRICHED: "host-enriched",
  DECORATED: "decorated",
  NONE: "none",
} as const;

export type RegistrationObservation =
  (typeof REGISTRATION_OBSERVATION)[keyof typeof REGISTRATION_OBSERVATION];

/** A per-pass read an adapter needs before its projects are current. */
export interface ProviderRefresh {
  run(): Promise<void>;
  /** Opens the stderr line a failed run is reported under. */
  failureLabel: string;
}

export interface ProviderRegistration {
  adapter: SessionProviderAdapter;
  credential?: CredentialProvider;
  registerObservationHook?: () => Promise<void>;
  /** Absent means `REGISTRATION_OBSERVATION.HOST_ENRICHED`. */
  observation?: RegistrationObservation;
  refresh?: ProviderRefresh;
}

export function registrationObservation(
  registration: ProviderRegistration,
): RegistrationObservation {
  return registration.observation ?? REGISTRATION_OBSERVATION.HOST_ENRICHED;
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
    },
    [PROVIDER_ID.CODEX]: {
      adapter: codex,
      registerObservationHook: observationHookRegistration(
        installCodexObservationHooks,
        codexInstallation,
        now,
      ),
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

export interface WorkspaceProviderRegistrationOptions {
  registrations: Readonly<Record<ProviderId, ProviderRegistration>>;
  /**
   * Superset's package sits above this one in the graph, so its workspace
   * adapter — whose rows the Superset host read decorates — is handed in
   * rather than built here.
   */
  supersetWorkspace: SessionProviderAdapter;
  openExternal: (url: string) => Promise<void>;
}

/**
 * Every provider a workspace can be created through, keyed the way
 * `WORKSPACE_PROVIDER_ID_LIST` orders them: the observed providers, then the
 * two workspace-only providers. Local Conductor observes no sessions — a
 * local Conductor chat is already observed by the agent that runs it — so it
 * joins the pass only through its repository refresh.
 */
export function workspaceProviderRegistrations(options: WorkspaceProviderRegistrationOptions) {
  const conductorLocal = new ConductorLocalWorkspaceAdapter({
    openExternal: options.openExternal,
  });
  return {
    ...options.registrations,
    [SUPERSET_WORKSPACE_PROVIDER_ID]: {
      adapter: options.supersetWorkspace,
      observation: REGISTRATION_OBSERVATION.DECORATED,
    },
    [CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID]: {
      adapter: conductorLocal,
      observation: REGISTRATION_OBSERVATION.NONE,
      refresh: {
        run: () => conductorLocal.refresh(),
        failureLabel: "Conductor repository observation",
      },
    },
  } satisfies Readonly<Record<WorkspaceProviderId, ProviderRegistration>>;
}
