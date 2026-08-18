import { CompositeSessionProviderAdapter, type SessionProviderAdapter } from "@sidecar/core";
import { ClaudeCodeSessionAdapter } from "./claude-code-adapter";
import {
  CLAUDE_HOOK_SPOOL_MAXIMUM_AGE_MS,
  type ClaudeCodeHookInstallation,
  installClaudeCodeObservationHooks,
  pruneClaudeHookSpool,
} from "./claude-code-hooks";
import { CodexSessionAdapter } from "./codex-adapter";
import {
  CODEX_HOOK_SPOOL_MAXIMUM_AGE_MS,
  type CodexHookInstallation,
  installCodexObservationHooks,
  pruneCodexHookSpool,
} from "./codex-hooks";
import { ConductorSessionAdapter } from "./conductor-adapter";
import { CopilotSessionAdapter } from "./copilot-adapter";
import { CURSOR_PROVIDER, CursorSessionAdapter } from "./cursor-adapter";
import { CursorLocalSessionAdapter } from "./cursor-local-adapter";
import { DEVIN_PROVIDER, DevinSessionAdapter } from "./devin-adapter";
import { DevinLocalSessionAdapter } from "./devin-local-adapter";
import { JulesSessionAdapter } from "./jules-adapter";
import { OpenCodeSessionAdapter } from "./opencode-adapter";
import {
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDERS,
  type CredentialProvider,
  type CredentialProviderId,
} from "./shared/credential-providers";

export interface ProviderRegistration {
  adapter: SessionProviderAdapter;
  credential?: CredentialProvider;
  registerObservationHook?: () => Promise<void>;
}

export interface ProviderRegistrationOptions {
  readApiKey: (providerId: CredentialProviderId) => Promise<string | undefined>;
  claudeHookInstallation: () => ClaudeCodeHookInstallation;
  codexHookInstallation: () => CodexHookInstallation;
  now?: () => number;
}

export function providerRegistrations(
  options: ProviderRegistrationOptions,
): readonly ProviderRegistration[] {
  const now = options.now ?? Date.now;
  const claude = new ClaudeCodeSessionAdapter({
    hookEventsDirectory: () => options.claudeHookInstallation().spoolDirectory,
  });
  const codex = new CodexSessionAdapter({
    hookEventsDirectory: () => options.codexHookInstallation().spoolDirectory,
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

  return [
    {
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
    {
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
    {
      adapter: new ConductorSessionAdapter({
        readApiKey: () => options.readApiKey(CREDENTIAL_PROVIDER_ID.CONDUCTOR),
      }),
      credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.CONDUCTOR],
    },
    {
      adapter: new CopilotSessionAdapter({
        readApiKey: () => options.readApiKey(CREDENTIAL_PROVIDER_ID.COPILOT),
      }),
      credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.COPILOT],
    },
    {
      adapter: cursor,
      credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.CURSOR],
    },
    {
      adapter: devin,
      credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.DEVIN],
    },
    {
      adapter: new JulesSessionAdapter({
        readApiKey: () => options.readApiKey(CREDENTIAL_PROVIDER_ID.JULES),
      }),
      credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.JULES],
    },
    { adapter: new OpenCodeSessionAdapter() },
  ];
}
