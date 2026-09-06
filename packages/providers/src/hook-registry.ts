import path from "node:path";
import { PROVIDER_ID } from "@sidecar/session";
import { CLAUDE_HOOK_SCRIPT_NAME, defaultClaudeHome } from "./claude-code/hooks.js";
import { defaultCodexHome } from "./codex/adapter.js";
import { CODEX_HOOK_SCRIPT_NAME } from "./codex/hooks.js";
import type { ObservationHookInstallation } from "./shared/hook-merge.js";

const SPOOL_DIRECTORY = "events";

interface ObservationHookProviderEntry {
  directoryName: string;
  scriptName: string;
  providerHome: () => string;
}

/**
 * One row per provider that registers observation hooks at all: the directory
 * each arrangement keeps under Luke's own application data, the artifact it
 * installs, and the provider home the arrangement joins. Widening this table
 * to another provider is a product decision, not an implementation detail.
 */
const OBSERVATION_HOOK_PROVIDERS = {
  [PROVIDER_ID.CLAUDE_CODE]: {
    directoryName: "claude-code-hooks",
    scriptName: CLAUDE_HOOK_SCRIPT_NAME,
    providerHome: defaultClaudeHome,
  },
  [PROVIDER_ID.CODEX]: {
    directoryName: "codex-hooks",
    scriptName: CODEX_HOOK_SCRIPT_NAME,
    providerHome: defaultCodexHome,
  },
} as const satisfies Readonly<Record<string, ObservationHookProviderEntry>>;

export type ObservationHookProviderId = keyof typeof OBSERVATION_HOOK_PROVIDERS;

// SAFETY: the table is an `as const` literal with no inherited members, so
// its own keys are exactly its declared provider ids.
const HOOKED_PROVIDER_IDS = Object.keys(
  OBSERVATION_HOOK_PROVIDERS,
) as readonly ObservationHookProviderId[];

/** Every provider that registers an observation hook, in table order. */
export const OBSERVATION_HOOK_PROVIDER_IDS: readonly ObservationHookProviderId[] =
  HOOKED_PROVIDER_IDS;

/**
 * Luke's own corners of the application data, holding each provider's
 * observation hook script and the spool it writes into. Resolved lazily
 * because the application data path is not known until the app is ready, and
 * reproduced rather than stored so a run always converges on the paths this
 * build names.
 */
export class ObservationHookRegistry {
  readonly #userDataDirectory: () => string;

  constructor(userDataDirectory: () => string) {
    this.#userDataDirectory = userDataDirectory;
  }

  installation(providerId: ObservationHookProviderId): ObservationHookInstallation {
    const entry: ObservationHookProviderEntry = OBSERVATION_HOOK_PROVIDERS[providerId];
    const directory = path.join(this.#userDataDirectory(), entry.directoryName);
    const providerHome = entry.providerHome();
    return {
      providerHome,
      hookScriptPath: path.join(directory, entry.scriptName),
      spoolDirectory: path.join(directory, SPOOL_DIRECTORY),
    };
  }
}
