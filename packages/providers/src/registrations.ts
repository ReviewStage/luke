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
import { ClaudeCodeSessionAdapter } from "./claude-code/adapter.js";
import {
  CLAUDE_HOOK_SPOOL_MAXIMUM_AGE_MS,
  type ClaudeCodeHookInstallation,
  installClaudeCodeObservationHooks,
  pruneClaudeHookSpool,
} from "./claude-code/hooks.js";
import { CODEX_PROVIDER, CodexSessionAdapter } from "./codex/adapter.js";
import type { CodexCloudSessionAdapter } from "./codex/cloud-adapter.js";
import {
  CODEX_HOOK_SPOOL_MAXIMUM_AGE_MS,
  type CodexHookInstallation,
  installCodexObservationHooks,
  pruneCodexHookSpool,
} from "./codex/hooks.js";
import { ConductorSessionAdapter } from "./conductor/adapter.js";
import { CopilotSessionAdapter } from "./copilot/adapter.js";
import { CURSOR_PROVIDER, CursorSessionAdapter } from "./cursor/adapter.js";
import { CursorLocalSessionAdapter } from "./cursor/local-adapter.js";
import { DEVIN_PROVIDER, DevinSessionAdapter } from "./devin/adapter.js";
import { DevinLocalSessionAdapter } from "./devin/local-adapter.js";
import { JulesSessionAdapter } from "./jules/adapter.js";
import { OpenCodeSessionAdapter } from "./opencode/adapter.js";

export interface ProviderRegistration {
  adapter: SessionProviderAdapter;
  credential?: CredentialProvider;
  registerObservationHook?: () => Promise<void>;
}

export interface ProviderRegistrationOptions {
  readApiKey: (providerId: CredentialProviderId) => Promise<string | undefined>;
  claudeHookInstallation: () => ClaudeCodeHookInstallation;
  codexHookInstallation: () => CodexHookInstallation;
  /**
   * Constructed by the caller rather than here, because the app also asks it
   * what the latest pass learned about the Codex CLI login — the settings
   * snapshot reports that beside the key sources — and the reference the
   * settings read is the reference the composite observes with.
   */
  codexCloudAdapter: CodexCloudSessionAdapter;
  now?: () => number;
}

export function providerRegistrations(options: ProviderRegistrationOptions) {
  const now = options.now ?? Date.now;
  const claude = new ClaudeCodeSessionAdapter({
    hookEventsDirectory: () => options.claudeHookInstallation().spoolDirectory,
  });
  // Codex runs sessions in two places: on this machine, observed from its own
  // transcripts, and in Codex cloud, observed through the Codex CLI's
  // documented read under the ChatGPT login the user already gave that CLI.
  const codex = new CompositeSessionProviderAdapter({
    provider: CODEX_PROVIDER,
    adapters: [
      new CodexSessionAdapter({
        hookEventsDirectory: () => options.codexHookInstallation().spoolDirectory,
      }),
      options.codexCloudAdapter,
    ],
  });
  const cursor = new CompositeSessionProviderAdapter({
    provider: CURSOR_PROVIDER,
    adapters: [
      new CursorLocalSessionAdapter(),
      new CursorSessionAdapter({
        readApiKey: () => options.readApiKey(CREDENTIAL_PROVIDER_ID.CURSOR),
      }),
    ],
  });
  const devin = new CompositeSessionProviderAdapter({
    provider: DEVIN_PROVIDER,
    adapters: [
      new DevinLocalSessionAdapter(),
      new DevinSessionAdapter({
        readApiKey: () => options.readApiKey(CREDENTIAL_PROVIDER_ID.DEVIN),
      }),
    ],
  });

  return {
    [PROVIDER_ID.CLAUDE_CODE]: {
      adapter: claude,
      registerObservationHook: async () => {
        const installation = options.claudeHookInstallation();
        await installClaudeCodeObservationHooks(installation);
        await pruneClaudeHookSpool(
          installation.spoolDirectory,
          CLAUDE_HOOK_SPOOL_MAXIMUM_AGE_MS,
          now(),
        );
      },
    },
    [PROVIDER_ID.CODEX]: {
      adapter: codex,
      registerObservationHook: async () => {
        const installation = options.codexHookInstallation();
        await installCodexObservationHooks(installation);
        await pruneCodexHookSpool(
          installation.spoolDirectory,
          CODEX_HOOK_SPOOL_MAXIMUM_AGE_MS,
          now(),
        );
      },
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
    },
    [PROVIDER_ID.DEVIN]: {
      adapter: devin,
      credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.DEVIN],
    },
    [PROVIDER_ID.JULES]: {
      adapter: new JulesSessionAdapter({
        readApiKey: () => options.readApiKey(CREDENTIAL_PROVIDER_ID.JULES),
      }),
      credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.JULES],
    },
    [PROVIDER_ID.OPENCODE]: { adapter: new OpenCodeSessionAdapter() },
  } satisfies Readonly<Record<ProviderId, ProviderRegistration>>;
}
