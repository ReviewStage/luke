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
import { installClaudeCodeObservationHooks } from "./claude-code/hooks.js";
import { CODEX_PROVIDER } from "./codex/adapter.js";
import type { CodexCloudSessionAdapter } from "./codex/cloud-adapter.js";
import { installCodexObservationHooks } from "./codex/hooks.js";
import { ConductorSessionAdapter } from "./conductor/adapter.js";
import { CopilotSessionAdapter } from "./copilot/adapter.js";
import { CURSOR_PROVIDER, CursorSessionAdapter } from "./cursor/adapter.js";
import { installCursorObservationHooks } from "./cursor/hooks.js";
import { DEVIN_PROVIDER, DevinSessionAdapter } from "./devin/adapter.js";
import { installDevinObservationHooks } from "./devin/hooks.js";
import { installGeminiObservationHooks } from "./gemini-cli/hooks.js";
import type { ObservationHookProviderId } from "./hook-registry.js";
import { JulesSessionAdapter } from "./jules/adapter.js";
import { localSessionAdapters } from "./local-adapters.js";
import { installOpenCodeObservationPlugin } from "./opencode/hooks.js";
import { ReplicasSessionAdapter } from "./replicas/adapter.js";
import type {
  AdapterDiagnosticCallback,
  AdapterDiagnosticKind,
} from "./shared/adapter-diagnostics.js";
import {
  HOOK_SPOOL_MAXIMUM_AGE_MS,
  type ObservationHookInstallation,
  pruneObservationHookSpool,
} from "./shared/hook-merge.js";

export interface ProviderRegistration {
  adapter: SessionProviderAdapter;
  credential?: CredentialProvider;
  registerObservationHook?: () => Promise<void>;
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
   * Whether this machine currently registers a handler for the Replicas
   * desktop app's URL scheme, answered by the caller because only the
   * operating system knows — it is the same question the OS answers when a
   * row's address is handed to it. Absent, Replicas addresses stay the web
   * dashboard's.
   */
  replicasDesktopAppPresent?: () => boolean;
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
  const cursorInstallation = hookInstallation(PROVIDER_ID.CURSOR);
  const devinInstallation = hookInstallation(PROVIDER_ID.DEVIN);
  const geminiInstallation = hookInstallation(PROVIDER_ID.GEMINI_CLI);
  const opencodeInstallation = hookInstallation(PROVIDER_ID.OPENCODE);
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
  const cursor = new CompositeSessionProviderAdapter({
    provider: CURSOR_PROVIDER,
    adapters: [
      locals.cursorLocal,
      new CursorSessionAdapter({
        readApiKey: () => options.readApiKey(CREDENTIAL_PROVIDER_ID.CURSOR),
        ...adapterDiagnostics(PROVIDER_ID.CURSOR, options.onDiagnostic),
      }),
    ],
  });
  const devin = new CompositeSessionProviderAdapter({
    provider: DEVIN_PROVIDER,
    adapters: [
      locals.devinLocal,
      new DevinSessionAdapter({
        readApiKey: () => options.readApiKey(CREDENTIAL_PROVIDER_ID.DEVIN),
        ...adapterDiagnostics(PROVIDER_ID.DEVIN, options.onDiagnostic),
      }),
    ],
  });

  return {
    // Antigravity registers no hook: the summaries index its apps keep
    // already tells a settled turn from a permission hold, so nothing of
    // Antigravity's needs writing to.
    [PROVIDER_ID.ANTIGRAVITY]: {
      adapter: locals.antigravity,
    },
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
    [PROVIDER_ID.COPILOT]: {
      adapter: new CopilotSessionAdapter({
        readApiKey: () => options.readApiKey(CREDENTIAL_PROVIDER_ID.COPILOT),
        ...adapterDiagnostics(PROVIDER_ID.COPILOT, options.onDiagnostic),
      }),
      credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.COPILOT],
    },
    [PROVIDER_ID.CURSOR]: {
      adapter: cursor,
      credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.CURSOR],
      registerObservationHook: observationHookRegistration(
        installCursorObservationHooks,
        cursorInstallation,
        now,
      ),
    },
    [PROVIDER_ID.DEVIN]: {
      adapter: devin,
      credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.DEVIN],
      registerObservationHook: observationHookRegistration(
        installDevinObservationHooks,
        devinInstallation,
        now,
      ),
    },
    [PROVIDER_ID.GEMINI_CLI]: {
      adapter: locals.geminiCli,
      registerObservationHook: observationHookRegistration(
        installGeminiObservationHooks,
        geminiInstallation,
        now,
      ),
    },
    // Grok Build's own stores already say whose move it is — the database's
    // newest message, or the 1.0.x lifecycle log with its permission prompts
    // — so its adapter needs no observation hook.
    [PROVIDER_ID.GROK_BUILD]: { adapter: locals.grokBuild },
    [PROVIDER_ID.JULES]: {
      adapter: new JulesSessionAdapter({
        readApiKey: () => options.readApiKey(CREDENTIAL_PROVIDER_ID.JULES),
        ...adapterDiagnostics(PROVIDER_ID.JULES, options.onDiagnostic),
      }),
      credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.JULES],
    },
    // OMP's JSONL recordings already say whose move it is: message roles,
    // unmatched tool_execution_start, and session_exit. No observation hook.
    [PROVIDER_ID.OMP]: { adapter: locals.omp },
    [PROVIDER_ID.OPENCODE]: {
      adapter: locals.openCode,
      // The registration is a managed plugin file in OpenCode's own plugin
      // directory rather than a merged entry, but it converges and prunes on
      // the same launch cadence as every other provider's.
      registerObservationHook: observationHookRegistration(
        installOpenCodeObservationPlugin,
        opencodeInstallation,
        now,
      ),
    },
    // The browser's own store already says whose move it is — a turn's row
    // records when it ended and what ended it — so its adapter needs no
    // observation hook, and Radius publishes no hook surface to join anyway.
    [PROVIDER_ID.RADIUS]: { adapter: locals.radius },
    [PROVIDER_ID.REPLICAS]: {
      adapter: new ReplicasSessionAdapter({
        readApiKey: () => options.readApiKey(CREDENTIAL_PROVIDER_ID.REPLICAS),
        ...(options.replicasDesktopAppPresent
          ? { desktopAppPresent: options.replicasDesktopAppPresent }
          : undefined),
        ...adapterDiagnostics(PROVIDER_ID.REPLICAS, options.onDiagnostic),
      }),
      credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.REPLICAS],
    },
  } satisfies Readonly<Record<ProviderId, ProviderRegistration>>;
}
