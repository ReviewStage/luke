import {
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDERS,
  type CredentialProvider,
  type CredentialProviderId,
} from "@sidecar/credentials";
import {
  CompositeSessionProviderAdapter,
  PROVIDER_ID,
  type ProviderId,
  type SessionProviderAdapter,
} from "@sidecar/session";
import { AntigravitySessionAdapter } from "./antigravity/adapter.js";
import { ClaudeCodeSessionAdapter } from "./claude-code/adapter.js";
import { installClaudeCodeObservationHooks } from "./claude-code/hooks.js";
import { CODEX_PROVIDER, CodexSessionAdapter } from "./codex/adapter.js";
import type { CodexCloudSessionAdapter } from "./codex/cloud-adapter.js";
import { installCodexObservationHooks } from "./codex/hooks.js";
import { ConductorSessionAdapter } from "./conductor/adapter.js";
import { CopilotSessionAdapter } from "./copilot/adapter.js";
import { CURSOR_PROVIDER, CursorSessionAdapter } from "./cursor/adapter.js";
import { installCursorObservationHooks } from "./cursor/hooks.js";
import { CursorLocalSessionAdapter } from "./cursor/local-adapter.js";
import { DEVIN_PROVIDER, DevinSessionAdapter } from "./devin/adapter.js";
import { installDevinObservationHooks } from "./devin/hooks.js";
import { DevinLocalSessionAdapter } from "./devin/local-adapter.js";
import { GeminiCliSessionAdapter } from "./gemini-cli/adapter.js";
import { installGeminiObservationHooks } from "./gemini-cli/hooks.js";
import { GrokBuildSessionAdapter } from "./grok-build/adapter.js";
import type { ObservationHookProviderId } from "./hook-registry.js";
import { JulesSessionAdapter } from "./jules/adapter.js";
import { OpenCodeSessionAdapter } from "./opencode/adapter.js";
import { installOpenCodeObservationPlugin } from "./opencode/hooks.js";
import { ReplicasSessionAdapter } from "./replicas/adapter.js";
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
  now?: () => number;
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
  const claude = new ClaudeCodeSessionAdapter({
    hookEventsDirectory: () => claudeInstallation().spoolDirectory,
  });
  // Codex runs sessions in two places: on this machine, observed from its own
  // transcripts, and in Codex cloud, observed through the Codex CLI's
  // documented read under the ChatGPT login the user already gave that CLI.
  const codex = new CompositeSessionProviderAdapter({
    provider: CODEX_PROVIDER,
    adapters: [
      new CodexSessionAdapter({
        hookEventsDirectory: () => codexInstallation().spoolDirectory,
      }),
      options.codexCloudAdapter,
    ],
  });
  const cursor = new CompositeSessionProviderAdapter({
    provider: CURSOR_PROVIDER,
    adapters: [
      new CursorLocalSessionAdapter({
        hookEventsDirectory: () => cursorInstallation().spoolDirectory,
      }),
      new CursorSessionAdapter({
        readApiKey: () => options.readApiKey(CREDENTIAL_PROVIDER_ID.CURSOR),
      }),
    ],
  });
  const devin = new CompositeSessionProviderAdapter({
    provider: DEVIN_PROVIDER,
    adapters: [
      new DevinLocalSessionAdapter({
        hookEventsDirectory: () => devinInstallation().spoolDirectory,
      }),
      new DevinSessionAdapter({
        readApiKey: () => options.readApiKey(CREDENTIAL_PROVIDER_ID.DEVIN),
      }),
    ],
  });

  return {
    // Antigravity registers no hook: the summaries index its apps keep
    // already tells a settled turn from a permission hold, so nothing of
    // Antigravity's needs writing to.
    [PROVIDER_ID.ANTIGRAVITY]: {
      adapter: new AntigravitySessionAdapter(),
    },
    [PROVIDER_ID.CLAUDE_CODE]: {
      adapter: claude,
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
      }),
      credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.CONDUCTOR],
    },
    [PROVIDER_ID.COPILOT]: {
      adapter: new CopilotSessionAdapter({
        readApiKey: () => options.readApiKey(CREDENTIAL_PROVIDER_ID.COPILOT),
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
      adapter: new GeminiCliSessionAdapter({
        hookEventsDirectory: () => geminiInstallation().spoolDirectory,
      }),
      registerObservationHook: observationHookRegistration(
        installGeminiObservationHooks,
        geminiInstallation,
        now,
      ),
    },
    // Grok Build's own stores already say whose move it is — the database's
    // newest message, or the 1.0.x lifecycle log with its permission prompts
    // — so its adapter needs no observation hook.
    [PROVIDER_ID.GROK_BUILD]: { adapter: new GrokBuildSessionAdapter() },
    [PROVIDER_ID.JULES]: {
      adapter: new JulesSessionAdapter({
        readApiKey: () => options.readApiKey(CREDENTIAL_PROVIDER_ID.JULES),
      }),
      credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.JULES],
    },
    [PROVIDER_ID.OPENCODE]: {
      adapter: new OpenCodeSessionAdapter({
        hookEventsDirectory: () => opencodeInstallation().spoolDirectory,
      }),
      // The registration is a managed plugin file in OpenCode's own plugin
      // directory rather than a merged entry, but it converges and prunes on
      // the same launch cadence as every other provider's.
      registerObservationHook: observationHookRegistration(
        installOpenCodeObservationPlugin,
        opencodeInstallation,
        now,
      ),
    },
    [PROVIDER_ID.REPLICAS]: {
      adapter: new ReplicasSessionAdapter({
        readApiKey: () => options.readApiKey(CREDENTIAL_PROVIDER_ID.REPLICAS),
      }),
      credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.REPLICAS],
    },
  } satisfies Readonly<Record<ProviderId, ProviderRegistration>>;
}
