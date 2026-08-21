import path from "node:path";
import { PROVIDER_ID } from "@sidecar/session";
import { CLAUDE_HOOK_SCRIPT_NAME, defaultClaudeHome } from "./claude-code/hooks.js";
import { defaultCodexHome } from "./codex/adapter.js";
import { CODEX_HOOK_SCRIPT_NAME } from "./codex/hooks.js";
import { CURSOR_HOOK_SCRIPT_NAME } from "./cursor/hooks.js";
import { defaultCursorHome } from "./cursor/local-adapter.js";
import { GEMINI_HOOK_SCRIPT_NAME } from "./gemini-cli/hooks.js";
import { defaultGeminiCliHome } from "./gemini-cli/records.js";
import type { ObservationHookInstallation } from "./shared/hook-merge.js";

const SPOOL_DIRECTORY = "events";

/**
 * One row per provider that registers observation hooks at all: the directory
 * each arrangement keeps under Luke's own application data, the script inside
 * it, and the provider home its registration merges into. Widening this table
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
  [PROVIDER_ID.CURSOR]: {
    directoryName: "cursor-hooks",
    scriptName: CURSOR_HOOK_SCRIPT_NAME,
    providerHome: defaultCursorHome,
  },
  [PROVIDER_ID.GEMINI_CLI]: {
    directoryName: "gemini-cli-hooks",
    scriptName: GEMINI_HOOK_SCRIPT_NAME,
    providerHome: defaultGeminiCliHome,
  },
} as const;

export type ObservationHookProviderId = keyof typeof OBSERVATION_HOOK_PROVIDERS;

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
    const entry = OBSERVATION_HOOK_PROVIDERS[providerId];
    const directory = path.join(this.#userDataDirectory(), entry.directoryName);
    return {
      providerHome: entry.providerHome(),
      hookScriptPath: path.join(directory, entry.scriptName),
      spoolDirectory: path.join(directory, SPOOL_DIRECTORY),
    };
  }
}
